import re

with open('mccia-awards/assets/css/styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Update fonts for Corporate Premium
css = re.sub(
    r"@import url\('https://fonts.googleapis.com/css2\?family=Inter.*?display=swap'\);",
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@300;400;700;900&display=swap');",
    css
)

css = css.replace(
    "--font-display: 'Playfair Display', \"Iowan Old Style\", Georgia, serif;",
    "--font-display: 'Merriweather', \"Iowan Old Style\", Georgia, serif;"
)

# Deepen corporate navy tones and refine gold
css = css.replace("--navy-950: #020e18;", "--navy-950: #03121F;")
css = css.replace("--navy-900: #041826;", "--navy-900: #061F33;")
css = css.replace("--navy-800: #06263a;", "--navy-800: #092C47;")
css = css.replace("--navy-700: #07354f;", "--navy-700: #0C3E61;")
css = css.replace("--blue-600: #0a78c8;", "--blue-600: #0056B3;")
css = css.replace("--blue-500: #2492e8;", "--blue-500: #0069D9;")
css = css.replace("--gold-600: #9a7318;", "--gold-600: #8C7335;")
css = css.replace("--gold-500: #c19522;", "--gold-500: #B89B4A;")
css = css.replace("--gold-400: #e3bc50;", "--gold-400: #D4B76A;")

# Sharper shadows for corporate look
css = css.replace(
    "--shadow-1: 0 1px 3px rgba(4,25,42,.05), 0 4px 12px rgba(4,25,42,.06);",
    "--shadow-1: 0 2px 4px rgba(0, 0, 0, 0.04), 0 8px 16px rgba(0, 0, 0, 0.04);"
)
css = css.replace(
    "--shadow-2: 0 4px 10px rgba(4,25,42,.06), 0 14px 32px rgba(4,25,42,.09);",
    "--shadow-2: 0 4px 8px rgba(0, 0, 0, 0.06), 0 16px 32px rgba(0, 0, 0, 0.06);"
)

# Refine gradients (more subtle, linear and corporate)
css = css.replace(
    "--grad-hero: linear-gradient(155deg, var(--navy-950) 0%, #064060 55%, #084f72 100%);",
    "--grad-hero: linear-gradient(145deg, var(--navy-950) 0%, var(--navy-800) 100%);"
)

# Buttons corporate style (less pill, more structured)
css = css.replace("--r-pill: 999px;", "--r-pill: 4px;") # Structured buttons

with open('mccia-awards/assets/css/styles.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("Corporate Premium styles applied.")
