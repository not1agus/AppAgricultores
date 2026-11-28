/**
 * La app muestra las respuestas de la IA como texto plano. Aunque el prompt
 * pide no usar markdown, el modelo a veces lo usa igual: aquí se quitan las
 * marcas para que no salgan "**", "###" o "---" en pantalla. El contenido
 * (palabras, números, emojis) no se toca.
 */
export function toPlainText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => {
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return ''; // separador ---
    return line
      .replace(/^(\s*)#{1,6}\s+/, '$1') // títulos
      .replace(/^(\s*)>\s?/, '$1') // citas
      .replace(/^(\s*)[*+]\s+/, '$1- '); // viñetas "* " / "+ "
  });

  return lines
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1') // negrita
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2') // cursiva
    .replace(/`([^`\n]+)`/g, '$1') // código en línea
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
