import re

# ── 1. index.html changes ──────────────────────────────────────────────
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Shorten long chip labels (overflow fix)
html = html.replace('>Sustainability &amp; Green Initiatives<', '>Sustainability<')
html = html.replace('>Agriculture, Dairy &amp; Food Processing<', '>Agri, Dairy &amp; Food<')
html = html.replace('>First-Generation Entrepreneurship<', '>First-Gen Entrepreneurs<')
html = html.replace('>Exports &amp; International Business<', '>Exports &amp; Trade<')
html = html.replace('>Corporate Social Responsibility<', '>Social Responsibility<')
html = html.replace('>Innovation &amp; Entrepreneurship<', '>Innovation<')
html = html.replace('>Women Entrepreneurship<', '>Women Entrepreneurs<')
html = html.replace('>Defence Manufacturing<', '>Defence<')

# Remove the duplicate stat band
html = re.sub(
    r'\s*<div class="statband">.*?</div>\s*</div>\s*</div>',
    '</div>\n  </div>',
    html,
    flags=re.DOTALL,
    count=1
)

# Upgrade hero pills - wrap in semantic list
html = html.replace(
    '<div class="hero__pills">',
    '<ul class="hero__pills" role="list" aria-label="Award highlights">'
)
html = html.replace(
    '</div>\n                <div class="truststrip">',
    '</ul>\n                <div class="truststrip">'
)
# Wrap pill spans in li
html = re.sub(r'<span class="pill(.*?)">(.*?)</span>', r'<li class="pill\1">\2</li>', html)

# Remove the recognition section (redundant - now just a single sentence)
html = re.sub(
    r'\s*<section class="section section--soft" id="recognition"[^>]*>.*?</section>',
    '',
    html,
    flags=re.DOTALL
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("HTML done.")
