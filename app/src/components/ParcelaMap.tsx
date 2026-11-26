import { StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

import type { GeoJsonPolygon } from '@/services/parcelas.service';
import { theme } from '@/theme';

export interface ParcelaMapShape {
  geometry: GeoJsonPolygon;
  label: string;
}

interface Props {
  shapes: ParcelaMapShape[] | null;
  height?: number;
}

const FILL_COLORS = [
  '#4ade80', '#60a5fa', '#f97316', '#a78bfa', '#f472b6',
];

function buildHtml(shapes: ParcelaMapShape[]): string {
  const features = shapes.map((s, i) => ({
    type: 'Feature',
    geometry: s.geometry,
    properties: {
      label: s.label,
      fillColor: FILL_COLORS[i % FILL_COLORS.length],
    },
  }));
  const featureCollection = JSON.stringify({ type: 'FeatureCollection', features });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var data = ${featureCollection};
    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    var layer = L.geoJSON(data, {
      style: function(feature) {
        return {
          color: '#16a34a',
          weight: 2,
          fillColor: feature.properties.fillColor,
          fillOpacity: 0.3
        };
      }
    }).addTo(map);
    if (layer.getBounds().isValid()) {
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    }
  </script>
</body>
</html>`;
}

export function ParcelaMap({ shapes, height = 220 }: Props): JSX.Element {
  if (!shapes || shapes.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Sin geometría disponible</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        source={{ html: buildHtml(shapes) }}
        style={styles.webview}
        scrollEnabled={false}
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  empty: {
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
});
