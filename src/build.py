"""把 src/ 內的樣式、資料與程式組成單一檔案的 index.html（輸出到專案根目錄）。

用法：python3 src/build.py
"""
import pathlib

d = pathlib.Path(__file__).parent
t = (d / 'index.template.html').read_text(encoding='utf-8')
t = t.replace('/*__CSS__*/', (d / 'style.css').read_text(encoding='utf-8'))
t = t.replace('/*__DATA__*/', (d / 'data.js').read_text(encoding='utf-8'))
t = t.replace('/*__DATA2__*/', (d / 'data2.js').read_text(encoding='utf-8'))
t = t.replace('/*__APP__*/', (d / 'app.js').read_text(encoding='utf-8'))
out = d.parent / 'index.html'
out.write_text(t, encoding='utf-8')
print('built', out, len(t.encode()) // 1024, 'KB')
