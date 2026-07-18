import os
import json
import shutil
import uuid
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="SuiriMap API",
    description="水路・農地見える化アプリのAPI",
    version="1.0.0"
)

# CORS の設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
WATERWAYS_PATH = os.path.join(DATA_DIR, "waterways.json")
IMAGES_DIR = os.path.join(DATA_DIR, "images")

# 画像用ディレクトリの自動生成
os.makedirs(IMAGES_DIR, exist_ok=True)

# リクエストモデル
class WaterwayData(BaseModel):
    geojson: dict

@app.get("/api/waterways")
def get_waterways():
    """
    保存されている水路データを取得します。
    """
    if not os.path.exists(WATERWAYS_PATH):
        return {"type": "FeatureCollection", "features": []}
    try:
        with open(WATERWAYS_PATH, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"水路データの読み込みに失敗しました: {str(e)}")

@app.post("/api/waterways")
def save_waterways(data: WaterwayData):
    """
    水路データをJSONファイルに保存します。
    """
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(WATERWAYS_PATH, "w", encoding="utf-8-sig") as f:
            json.dump(data.geojson, f, ensure_ascii=False, indent=2)
        return {"success": True, "message": "水路データを保存しました。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"水路データの保存に失敗しました: {str(e)}")

@app.post("/api/upload")
def upload_image(file: UploadFile = File(...)):
    """
    施設用の画像アップロードを受け付け、保存した画像のURLを返します。
    """
    try:
        # 拡張子の取得とチェック
        ext = os.path.splitext(file.filename)[1]
        if ext.lower() not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            raise HTTPException(status_code=400, detail="許可されていない画像形式です。")
            
        # 一意なファイル名の生成
        filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(IMAGES_DIR, filename)
        
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        return {"url": f"/images/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"画像のアップロードに失敗しました: {str(e)}")

# アップロード画像配信用の静的ルートマウント
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")

# 静的ファイルの配信設定
static_path = os.path.join(BASE_DIR, "app", "static")

# ディレクトリの自動生成
if not os.path.exists(static_path):
    os.makedirs(static_path)
    os.makedirs(os.path.join(static_path, "css"))
    os.makedirs(os.path.join(static_path, "js"))

app.mount("/", StaticFiles(directory=static_path, html=True), name="static")
