import re
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r' type="[a-zA-Z0-9]+-text/javascript"', '', content)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
