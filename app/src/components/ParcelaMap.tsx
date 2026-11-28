import { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// react-native-webview no tiene shim oficial en web (SDK 54). Importarlo en
// web rompe el bundle. Cargamos el componente vía require dinámico SOLO en
// nativo; en web devolvemos un placeholder que renderiza un iframe con el
// mismo HTML de Leaflet.
const WebView: React.ComponentType<any> | null =
  Platform.OS === 'web' ? null : (require('react-native-webview').WebView as React.ComponentType<any>);

import type { GeoJsonPolygon } from '@/services/parcelas.service';
import { theme } from '@/theme';

// Map render strategy: a single self-contained HTML doc loaded into a
// WebView. Leaflet + Esri World Imagery tiles via CDN. We embed the
// geometry in the doc itself (no postMessage round-trip) so the map
// paints in one render and feels native — the only "loading" the user
// sees is the tile fetch.
//
// Why WebView over react-native-maps:
//   * Stays in the Expo managed workflow (no prebuild required for v1)
//   * One small dep (react-native-webview is on the Expo blessed list)
//   * Tiles come from Esri's free service — no API key, attribution
//     baked into the Leaflet plugin's defaults.
//
// Tradeoffs:
//   * No native gestures parity with react-native-maps (good enough for
//     a glance/verify use case; not for routing or measurement)
//   * Requires network for tiles. The polygon itself still renders
//     offline (it's inline in the HTML), but the basemap goes blank.

export interface ParcelaMapShape {
  geometry: GeoJsonPolygon;
  /** Optional label (e.g. parcela name) to anchor on the centroid. */
  label?: string;
  /** Optional fill colour override; default is the app primary green. */
  color?: string;
}

interface Props {
  /** When `null` we show an empty state; this is normal for parcelas
   * created without a SIGPAC lookup or with cleared geometry. */
  shapes: ParcelaMapShape[] | null;
  /** Map widget height in dp. Defaults to a wide-but-not-tall ratio
   * that fits above the per-card content on a phone. */
  height?: number;
}

const DEFAULT_HEIGHT = 220;

/** Walk a Polygon or MultiPolygon, returning every [lng, lat] vertex.
 * Used both for centring/fitBounds calc and for a quick sanity check
 * that the geometry isn't empty. */
function flattenCoords(g: GeoJsonPolygon): [number, number][] {
  const out: [number, number][] = [];
  if (g.type === 'Polygon') {
    const rings = g.coordinates as number[][][];
    for (const ring of rings) {
      for (const pt of ring) {
        if (pt.length >= 2) out.push([pt[0]!, pt[1]!]);
      }
    }
  } else {
    const polys = g.coordinates as number[][][][];
    for (const poly of polys) {
      for (const ring of poly) {
        for (const pt of ring) {
          if (pt.length >= 2) out.push([pt[0]!, pt[1]!]);
        }
      }
    }
  }
  return out;
}

/** Bounds = south-west / north-east in [lat, lng] order, the format
 * Leaflet's fitBounds expects. */
function bounds(
  shapes: ParcelaMapShape[],
): { sw: [number, number]; ne: [number, number] } | null {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const s of shapes) {
    for (const [lng, lat] of flattenCoords(s.geometry)) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return {
    sw: [minLat, minLng],
    ne: [maxLat, maxLng],
  };
}

function buildHtml(shapes: ParcelaMapShape[]): string {
  // Keep the inlined JSON small — it sits inside <script> and Leaflet
  // re-parses on each render, but the polygon counts here (a handful of
  // parcelas with at most a few hundred verts each) keep this trivial.
  const safeShapes = shapes.map((s) => ({
    geometry: s.geometry,
    label: s.label ?? '',
    color: s.color ?? theme.colors.primary,
  }));
  const b = bounds(shapes);
  // Defensive: if bounds came back null we still render the basemap so
  // the user sees something rather than a blank panel.
  const initialBounds = b ? `[[${b.sw[0]},${b.sw[1]}],[${b.ne[0]},${b.ne[1]}]]` : 'null';

  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#1B1F1A; }
  .leaflet-container { background:#1B1F1A; }
  .parcela-label {
    background: rgba(27,31,26,0.78);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 2px 6px;
    font: 600 11px -apple-system, system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4);
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var shapes = ${JSON.stringify(safeShapes)};
  var initialBounds = ${initialBounds};
  var map = L.map('map', { zoomControl: true, attributionControl: false });

  // Esri World Imagery — free satellite tiles, no API key. Note: their
  // ToS asks for attribution (we render it minimally below to keep the
  // map clean). For higher-volume production, swap for a keyed provider.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri'
  }).addTo(map);

  L.control.attribution({ prefix: false, position: 'bottomright' })
    .addAttribution('Esri')
    .addTo(map);

  if (shapes.length === 0) {
    map.setView([40.4168, -3.7038], 6); // Spain default — only used when no geometry
    return;
  }

  shapes.forEach(function (s) {
    var layer = L.geoJSON(s.geometry, {
      style: {
        color: s.color,
        weight: 2,
        opacity: 1,
        fillColor: s.color,
        fillOpacity: 0.18
      }
    }).addTo(map);
    if (s.label) {
      // Anchor label at the visual centre (Leaflet's bounds centre is
      // good enough for our convex-ish parcelas; for crescent shapes a
      // proper polylabel would be better but we don't ship one).
      var c = layer.getBounds().getCenter();
      L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'parcela-label'
      })
        .setLatLng(c)
        .setContent(s.label)
        .addTo(map);
    }
  });

  if (initialBounds) {
    map.fitBounds(initialBounds, { padding: [16, 16] });
  }
})();
</script>
</body></html>`;
}

export function ParcelaMap({ shapes, height }: Props): JSX.Element {
  const h = height ?? DEFAULT_HEIGHT;

  // Memoise the HTML so React doesn't push a new `source` to the WebView
  // on unrelated parent re-renders (which would force a tile reload —
  // expensive on cellular). The dep list is the shapes themselves; if
  // the parent updates the polygon we want the new HTML.
  const html = useMemo(() => (shapes ? buildHtml(shapes) : null), [shapes]);

  if (!shapes || shapes.length === 0 || !html) {
    return (
      <View style={[styles.empty, { height: h }]}>
        <Text style={styles.emptyText}>Sin geometría</Text>
        <Text style={styles.emptyHint}>
          Asocia una referencia SIGPAC a la parcela para ver su contorno.
        </Text>
      </View>
    );
  }

  // Web: react-native-webview no existe. Inyectamos el mismo HTML en un
  // iframe nativo del navegador con un blob URL. La experiencia visual es
  // idéntica (Leaflet pinta igual). Mantenemos `srcDoc` para evitar
  // problemas de mixed-content si el host es https.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { height: h }]}>
        {/* iframe es un elemento DOM nativo del navegador. Bajo react-native-web
            no está tipado en el JSX de RN, por eso el cast a any. */}
        {(() => {
          const Iframe = 'iframe' as unknown as React.ElementType;
          return (
            <Iframe
              srcDoc={html}
              style={{
                border: 0,
                width: '100%',
                height: '100%',
                backgroundColor: '#1B1F1A',
              }}
              title="Mapa de parcela"
            />
          );
        })()}
      </View>
    );
  }

  // En nativo, el WebView fue cargado dinámicamente arriba. El !WebView no
  // debería darse aquí (Platform.OS !== 'web' implica que se cargó), pero
  // mantenemos el guard para tipado y degradamos al estado vacío de arriba.
  if (!WebView) {
    return (
      <View style={[styles.empty, { height: h }]}>
        <Text style={styles.emptyText}>Mapa no disponible</Text>
      </View>
    );
  }
  return (
    <View style={[styles.wrap, { height: h }]}>
      <WebView
        source={{ html }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        // Phone gestures: allow pinch/pan inside the map without the
        // outer ScrollView fighting for the touch.
        nestedScrollEnabled
        // Tile fetches and the Leaflet bundle come from CDN; loading
        // them is normal so we don't surface a spinner over the
        // map (Leaflet paints quickly once loaded).
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: '#1B1F1A',
    marginBottom: theme.spacing.md,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(27,31,26,0.4)',
  },
  empty: {
    width: '100%',
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});
