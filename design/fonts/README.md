# Fonts

The site uses two fonts. The web files it actually loads live in `frontend/src/assets/fonts/`
(Vite hashes and bundles them; `frontend/src/styles.css` declares them with `@font-face`):

| Font | Where on the site | Web file |
|------|-------------------|----------|
| KyivType Titling Bold | the «Ґуґля» logo | `KyivTypeTitling-Bold.woff2` (from the archive's `KyivType-NoVariable/WEB/`) |
| Montserrat (variable, 100–900) | all other text | `Montserrat-Variable.woff`, subset to Latin + Cyrillic + ₴ |

The original archives (`KyivType.zip`, `Montserrat.zip`, ~21 MB together) are kept here locally but are
not committed (see `.gitignore`); ask Taras for them or download them again:
KyivType — the `KyivType2020` archive; Montserrat — https://fonts.google.com/specimen/Montserrat (SIL OFL,
licence in `frontend/src/assets/fonts/Montserrat-OFL.txt`).

Re-making the Montserrat subset (needs `pip install fonttools`):

```
pyftsubset Montserrat-VariableFont_wght.ttf --flavor=woff --layout-features='*' \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2000-206F,U+20B4,U+2116,U+2122,U+2191,U+2193,U+2212,U+2215,U+2665" \
  --output-file=../../frontend/src/assets/fonts/Montserrat-Variable.woff
```
