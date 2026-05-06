import os
import re
import shutil
import subprocess
from webbrowser import get
from telethon import TelegramClient
import json

# --- НАЛАШТУВАННЯ ---
api_id = 34862924
api_hash = '196a5cbf881b31795dd6810537f8a9d8' 
channel_username = 'drop_jewellery'
client = TelegramClient('my_session', api_id, api_hash)

OUTPUT_DIR = 'site/videos'
PHOTO_DIR  = 'site/photos'
TEMP_DIR   = 'temp_photos' 

async def main():
    for folder in [OUTPUT_DIR, PHOTO_DIR, TEMP_DIR]:
        os.makedirs(folder, exist_ok=True)

    print("🚀 Запуск Стерильного Конвеєра...")
    
    all_messages = []
    products = {} 

    # 2. ЗБІР ДАНИХ
    print("📡 Сканування каналу...")
    async for message in client.iter_messages(channel_username): #, limit=1000):
        all_messages.append(message)
        text = message.text if message.text else ""
        clean_text = text.replace('*', '').replace('_', '')
        
        # --- SKU ---
        sku_match = re.search(r'Pandora.*?([\d]{3}-[\d]{5}|[A-Z\d]{6,})', clean_text, re.IGNORECASE | re.DOTALL)
        
        # --- ЦІНА ДРОПУ ---
        price_match = re.search(r'(?:дропу|дроп)[:\s]*(\d+)', clean_text, re.IGNORECASE)

        if sku_match and price_match:
            sku   = sku_match.group(1).strip()
            price = int(price_match.group(1)) + 350
            gid   = message.grouped_id if message.grouped_id else f"single_{message.id}"
            
            if gid not in products:
                # --- НАЗВА (перший рядок з "Pandora") ---
                name = f"Pandora {sku}"
                for line in clean_text.splitlines():
                    if 'pandora' in line.lower() and line.strip():
                        name = line.strip()
                        break

                # --- РЕКОМЕНДОВАНА ЦІНА ---
                rec_match = re.search(r'(?:рекомендована|рек)[^\d]*(\d+)', clean_text, re.IGNORECASE)
                rec_price = int(rec_match.group(1)) if rec_match else None

                # --- МАТЕРІАЛ ---
                mat_match = re.search(r'матеріал[:\s]+(.+)', clean_text, re.IGNORECASE)
                material  = mat_match.group(1).strip() if mat_match else None

                # --- ПРОБА ---
                probe_match = re.search(r'проба[:\s]+(.+)', clean_text, re.IGNORECASE)
                probe       = probe_match.group(1).strip() if probe_match else None

                # --- КАМІННЯ ---
                stone_match = re.search(r'(?:каміння|камінь|вставка)[:\s]+(.+)', clean_text, re.IGNORECASE)
                stones      = stone_match.group(1).strip() if stone_match else None

                # --- КОЛІР ---
                color_match = re.search(r'колір[:\s]+(.+)', clean_text, re.IGNORECASE)
                color       = color_match.group(1).strip() if color_match else None

                products[gid] = {
                    'sku':       sku,
                    'name':      name,
                    'price':     price,
                    'rec_price': rec_price,
                    'material':  material,
                    'probe':     probe,
                    'stones':    stones,
                    'color':     color,
                }
                print(f"✅ Знайдено: {name} | {price} ₴")

    if not products:
        print("❌ Товарів не знайдено.")
        return

    # 3. РЕНДЕР ТА ОНОВЛЕННЯ БАЗИ
    for gid, data in products.items():
        sku = data['sku']
        
        for msg in all_messages:
            msg_gid = msg.grouped_id if msg.grouped_id else f"single_{msg.id}"
            if msg_gid == gid and msg.media:
                video_filename = f"video_{sku}_{msg.id}.mp4"
                video_name     = os.path.join(OUTPUT_DIR, video_filename)
                
                try:
                    print(f"  🎬 Рендер: {sku}_{msg.id}")
                    photo_path = await msg.download_media(file=TEMP_DIR)

                    VIDEO_EXTS = ('.mp4', '.mov', '.avi', '.mkv', '.m4v')
                    is_video   = photo_path.lower().endswith(VIDEO_EXTS)

                    if is_video:
                        cmd = [
                            'ffmpeg', '-y', '-i', photo_path,
                            '-vf', "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
                            '-c:v', 'libx264', '-t', '15', '-pix_fmt', 'yuv420p', '-an', video_name
                        ]
                    else:
                        cmd = [
                            'ffmpeg', '-y', '-loop', '1', '-i', photo_path,
                            '-vf', (
                                "scale=1080:1920:force_original_aspect_ratio=increase,"
                                "crop=1080:1920,"
                                "zoompan=z='min(zoom+0.0008,1.3)':d=150:s=1080x1920:fps=60"
                                ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                            ),
                            '-c:v', 'libx264', '-t', '5', '-pix_fmt', 'yuv420p', video_name
                        ]
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

                    db_path = os.path.join('site', 'products.json')
                    
                    site_photo_name = f"thumb_{sku}_{msg.id}.jpg"
                    site_photo_path = os.path.join(PHOTO_DIR, site_photo_name)

                    if is_video:
                        # Витягуємо перший кадр з відео як thumbnail
                        thumb_cmd = [
                            'ffmpeg', '-y', '-i', photo_path,
                            '-vframes', '1', '-q:v', '2', site_photo_path
                        ]
                        subprocess.run(thumb_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
                    else:
                        shutil.copy(photo_path, site_photo_path)

                    # Базові поля — завжди є
                    new_entry = {
                        "sku":   sku,
                        "name":  data['name'],
                        "price": data['price'],
                        "video": f"videos/{video_filename}",
                        "photo": f"photos/{site_photo_name}",
                    }
                    # Додаткові поля — тільки якщо витягнулися
                    for field in ('rec_price', 'material', 'probe', 'stones', 'color'):
                        if data.get(field):
                            new_entry[field] = data[field]

                    products_list = []
                    if os.path.exists(db_path):
                        with open(db_path, 'r', encoding='utf-8') as f:
                            try:
                                products_list = json.load(f)
                            except json.JSONDecodeError:
                                print(f"    ⚠️  products.json порожній або пошкоджений — починаємо з нуля")
                                products_list = []

                    if not any(p['sku'] == sku for p in products_list):
                        products_list.insert(0, new_entry)
                        with open(db_path, 'w', encoding='utf-8') as f:
                            json.dump(products_list, f, indent=4, ensure_ascii=False)
                        print(f"    ✅ Товар {sku} додано в JSON")

                    if os.path.exists(photo_path):
                        os.remove(photo_path)

                except Exception as e:
                    print(f"  ❌ Помилка на {sku}: {e}")

    # 4. ФІНАЛЬНЕ ПРИБИРАННЯ
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    print("🏁 ВСЕ ГОТОВО. Перевіряй папку 'site'.")

with client:
    client.loop.run_until_complete(main())  
