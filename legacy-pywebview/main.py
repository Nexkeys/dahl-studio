import os
import sys
import webview
from backend import DahlAPI

def get_asset_path(relative_path):
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), relative_path)

def main():
    api = DahlAPI()
    html_file = get_asset_path(os.path.join("ui", "index.html"))
    
    window = webview.create_window(
        title="Dahl Studio - AI Code Editor",
        url=html_file,
        js_api=api,
        width=1320,
        height=850,
        min_size=(960, 640),
        background_color="#121316"
    )
    api.set_window(window)
    
    # Start webview with Edge Chromium / WebView2 backend
    webview.start(gui="edgechromium", debug=False)

if __name__ == "__main__":
    main()
