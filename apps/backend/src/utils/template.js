export function randomizeTemplate(template) {
  return template.replace(/\{([^}]+)\}/g, (_, variants) => {
    const options = variants.split('|').map((option) => option.trim());
    return options[Math.floor(Math.random() * options.length)] || '';
  });
}
