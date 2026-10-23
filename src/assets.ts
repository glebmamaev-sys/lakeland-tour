// Пути к статике с учётом базового URL сборки (на GitHub Pages сайт живёт в подпапке /lakeland-tour/).
export const asset = (p: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
