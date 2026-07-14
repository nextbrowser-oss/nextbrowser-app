# README language index

The root [`README.md`](../../README.md) is the canonical English edition. Every translation records the canonical SHA-256 revision it was translated from and must be updated whenever the English README changes.

<p align="center">
  <a href="../../README.md">English</a> ·
  <a href="es/README.md">Español</a> ·
  <a href="pt-BR/README.md">Português (Brasil)</a> ·
  <a href="zh-CN/README.md">简体中文</a> ·
  <a href="ja/README.md">日本語</a> ·
  <a href="ko/README.md">한국어</a> ·
  <a href="de/README.md">Deutsch</a> ·
  <a href="fr/README.md">Français</a> ·
  <a href="ru/README.md">Русский</a> ·
  <a href="uk/README.md">Українська</a> ·
  <a href="ar/README.md">العربية</a> ·
  <a href="hi/README.md">हिन्दी</a> ·
  <a href="tr/README.md">Türkçe</a> ·
  <a href="id/README.md">Bahasa Indonesia</a> ·
  <a href="vi/README.md">Tiếng Việt</a> ·
  <a href="th/README.md">ไทย</a> ·
  <a href="it/README.md">Italiano</a> ·
  <a href="pl/README.md">Polski</a> ·
  <a href="nl/README.md">Nederlands</a> ·
  <a href="fa/README.md">فارسی</a>
</p>

| Locale | Language | README |
| --- | --- | --- |
| `en` | English | [Open](../../README.md) |
| `es` | Español | [Abrir](es/README.md) |
| `pt-BR` | Português (Brasil) | [Abrir](pt-BR/README.md) |
| `zh-CN` | 简体中文 | [打开](zh-CN/README.md) |
| `ja` | 日本語 | [開く](ja/README.md) |
| `ko` | 한국어 | [열기](ko/README.md) |
| `de` | Deutsch | [Öffnen](de/README.md) |
| `fr` | Français | [Ouvrir](fr/README.md) |
| `ru` | Русский | [Открыть](ru/README.md) |
| `uk` | Українська | [Відкрити](uk/README.md) |
| `ar` | العربية | [فتح](ar/README.md) |
| `hi` | हिन्दी | [खोलें](hi/README.md) |
| `tr` | Türkçe | [Aç](tr/README.md) |
| `id` | Bahasa Indonesia | [Buka](id/README.md) |
| `vi` | Tiếng Việt | [Mở](vi/README.md) |
| `th` | ไทย | [เปิด](th/README.md) |
| `it` | Italiano | [Apri](it/README.md) |
| `pl` | Polski | [Otwórz](pl/README.md) |
| `nl` | Nederlands | [Openen](nl/README.md) |
| `fa` | فارسی | [باز کردن](fa/README.md) |

## Keeping translations synchronized

1. Update the canonical root `README.md` first.
2. Translate the complete change into all 19 editions without changing commands, code blocks, product names, paths, or URLs.
3. Update the source SHA-256 marker in each translation and the hashes in [`manifest.json`](manifest.json).
4. Run `node scripts/validate-i18n.mjs` from the repository root.
