import os
import re

# 1. Update index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix header nav
content = re.sub(
    r'<nav class="nav" aria-label="Awards sections">.*?</nav>',
    '<nav class="nav" aria-label="Awards sections">\n      <a href="index.html#awards">The awards</a>\n    </nav>',
    content, flags=re.DOTALL
)

# Fix mobile nav
content = re.sub(
    r'<div class="mobile-nav" id="mobileNav">\n  <ul>.*?<li><a class="btn',
    '<div class="mobile-nav" id="mobileNav">\n  <ul role="list">\n    <li><a href="index.html#awards">The awards</a></li>\n    <li><a class="btn',
    content, flags=re.DOTALL
)

# Fix jump bar
content = re.sub(
    r'<ul class="jumpbar__track">.*?</ul>',
    '<ul class="jumpbar__track" role="list">\n      <li><a href="#overview">Overview</a></li>\n      <li><a href="#awards">The awards</a></li>\n      <li><a href="#process">Process</a></li>\n      <li><a href="#jury">Jury</a></li>\n      <li><a href="#dates">Key dates</a></li>\n      <li><a href="#faq">FAQs</a></li>\n    </ul>',
    content, flags=re.DOTALL
)

# Fix footer award names
content = content.replace('>Parkhe Award<', '>G. S. Parkhe Award<')
content = content.replace('>Rathi Green Award<', '>Dr. R. J. Rathi Award<')
content = content.replace('>CSR Award<', '>B. G. Deshmukh IAS Award<')
content = content.replace('>Kiran Natu Puraskar<', '>Late Kiran Natu Puraskar<')
content = content.replace('>Ghorpade Award<', '>Brig. S. B. Ghorpade Award<')
content = content.replace('>Chitale Award<', '>Late Shri B. G. Chitale Award<')
content = content.replace('>Kirloskar Export Award<', '>S. L. Kirloskar Export Excellence Award<')
content = content.replace('>Sustainability Award<', '>MCCIA Award for Sustainability<')
content = content.replace('>Ramabai Joshi Award<', '>Ramabai Joshi Award<')

# Fix footer empty h4
content = content.replace('<h4>&nbsp;</h4>', '<h4 aria-hidden="true">&nbsp;</h4>')

# Add role="list" to classes
for cls in ['legacy', 'checklist', 'toc', 'side-list', 'side-nav', 'truststrip__list']:
    content = re.sub(rf'<ul class="{cls}"', f'<ul class="{cls}" role="list"', content)
    content = re.sub(rf'<ol class="{cls}"', f'<ol class="{cls}" role="list"', content)
    
# Fix award-card checkmark SVG to target icon
# Original: <polyline points="20 6 9 17 4 12"/>
# Target/tag: <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>
# Wait, let's just replace the specific SVG tag on award-card__for.
content = re.sub(
    r'(<p class="award-card__for"><svg[^>]*>)(?:<polyline[^>]*>)?.*?<\/svg>',
    r'\1<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    content
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

# 2. Update double periods and footer names in all HTML files in awards/
if os.path.exists('awards'):
    for filename in os.listdir('awards'):
        if filename.endswith('.html'):
            filepath = os.path.join('awards', filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                html = f.read()
            
            # Double period fix
            html = html.replace('.. Nominations', '. Nominations')
            
            # Footer names fix
            html = html.replace('>Parkhe Award<', '>G. S. Parkhe Award<')
            html = html.replace('>Rathi Green Award<', '>Dr. R. J. Rathi Award<')
            html = html.replace('>CSR Award<', '>B. G. Deshmukh IAS Award<')
            html = html.replace('>Kiran Natu Puraskar<', '>Late Kiran Natu Puraskar<')
            html = html.replace('>Ghorpade Award<', '>Brig. S. B. Ghorpade Award<')
            html = html.replace('>Chitale Award<', '>Late Shri B. G. Chitale Award<')
            html = html.replace('>Kirloskar Export Award<', '>S. L. Kirloskar Export Excellence Award<')
            html = html.replace('>Sustainability Award<', '>MCCIA Award for Sustainability<')
            html = html.replace('<h4>&nbsp;</h4>', '<h4 aria-hidden="true">&nbsp;</h4>')
            
            # Add role="list" to classes
            for cls in ['legacy', 'checklist', 'toc', 'side-list', 'side-nav', 'truststrip__list']:
                html = re.sub(rf'<ul class="{cls}"', f'<ul class="{cls}" role="list"', html)
                html = re.sub(rf'<ol class="{cls}"', f'<ol class="{cls}" role="list"', html)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html)
print("Done")
