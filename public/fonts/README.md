# Fonts

The site uses SF Pro (headings, body) and SF Compact (buttons, labels, nav) and nothing else.
Apple's fonts are licensed, so the font files are not in this repo. Add your own copies here:

- `SF-Pro.woff2` (or `SF-Pro.ttf` / `SF-Pro.otf`): the variable SF Pro font
- `SF-Compact.woff2` (or `SF-Compact.ttf` / `SF-Compact.otf`): the variable SF Compact font

Download both from https://developer.apple.com/fonts/ and convert to .woff2 if you want smaller files.
Commit them, deploy, and the site picks them up with no code changes.

Until the files are added, only visitors who have these fonts installed see them; everyone else gets the browser's default sans-serif.
