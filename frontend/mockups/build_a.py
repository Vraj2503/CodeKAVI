import sys

def build():
    with open('/Applications/Projects/CodeKavi/frontend/mockups/v3-shared-data.js', 'r') as f:
        js_data = f.read()

    with open('/Applications/Projects/CodeKavi/frontend/mockups/knowledge-graph-v3-A-template.html', 'r') as f:
        html_template = f.read()

    # The HTML template has a script tag: <script src="v3-shared-data.js"></script>
    # We replace it with <script>js_data</script>

    script_tag = '<script src="v3-shared-data.js"></script>'
    inline_script = f'<script>\n{js_data}\n</script>'
    
    final_html = html_template.replace(script_tag, inline_script)

    with open('/Applications/Projects/CodeKavi/frontend/mockups/knowledge-graph-v3-A.html', 'w') as f:
        f.write(final_html)
        
    print("Built knowledge-graph-v3-A.html successfully.")

if __name__ == "__main__":
    build()
