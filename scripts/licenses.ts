/**
 * Writes docs/THIRD_PARTY_LICENSES.md from installed packages.
 * Usage (inside the dev container): node scripts/licenses.ts
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Pkg {
  name: string;
  version: string;
  license?: string | { type: string };
  repository?: string | { url: string };
}

function collect(omitDev: boolean): Pkg[] {
  const out = execSync(`npm ls --all --parseable ${omitDev ? '--omit=dev' : ''}`, { encoding: 'utf8' });
  const seen = new Map<string, Pkg>();
  for (const dir of out.split('\n').slice(1)) {
    if (!dir.trim()) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg;
    seen.set(`${pkg.name}@${pkg.version}`, pkg);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function licenseOf(p: Pkg): string {
  if (!p.license) return 'BELİRTİLMEMİŞ';
  return typeof p.license === 'string' ? p.license : p.license.type;
}

function repoOf(p: Pkg): string {
  const r = typeof p.repository === 'string' ? p.repository : p.repository?.url;
  return (r ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
}

function table(pkgs: Pkg[]): string {
  const rows = pkgs.map((p) => `| ${p.name} | ${p.version} | ${licenseOf(p)} | ${repoOf(p)} |`);
  return ['| Paket | Sürüm | Lisans | Kaynak |', '|---|---|---|---|', ...rows].join('\n');
}

const prod = collect(true);
const all = collect(false);
const prodKeys = new Set(prod.map((p) => `${p.name}@${p.version}`));
const dev = all.filter((p) => !prodKeys.has(`${p.name}@${p.version}`));
const counts = new Map<string, number>();
for (const p of all) counts.set(licenseOf(p), (counts.get(licenseOf(p)) ?? 0) + 1);

const md = `# Üçüncü taraf lisans envanteri

Bu dosya \`scripts/licenses.ts\` ile kurulu paketlerden üretilmiştir; elle düzenlemeyin.

Oyunun görselleri (harita, yollar, binalar, araçlar, ikonlar, favicon) ve ses efektleri
kod ile üretilir; harici görsel, ses, font veya CDN varlığı **kullanılmaz**.

## Lisans özeti (tüm paketler)

${[...counts.entries()].map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Üretim paketine giren bağımlılıklar

Yalnızca bunlar \`dist/\` çıktısına girer.

${table(prod)}

## Yalnızca geliştirme/test araçları

Bu paketler yayınlanan dosyalara dahil edilmez.

${table(dev)}
`;

writeFileSync('docs/THIRD_PARTY_LICENSES.md', md);
console.warn(`Yazıldı: ${prod.length} üretim, ${dev.length} geliştirme paketi`);
