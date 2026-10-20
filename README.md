# 📚 KhoTruyện AI

Web app **cào truyện tự động + dịch sang tiếng Việt bằng Gemini API**. Gồm 2 service:

- **Web** (thư mục gốc — Next.js 16): giao diện tiếng Việt, REST API, xuất truyện.
- **Engine** (`mini-services/engine-service` — Bun): job engine chạy nền phía server — cào chương, gọi Gemini dịch, xoay vòng API key, phát sự kiện socket.io real-time. **Tiếp tục cào/dịch kể cả khi bạn đóng tab trình duyệt.**

## ✨ Tính năng

| Tính năng | Chi tiết |
|---|---|
| 🕷️ Cào truyện | 5 nguồn: `69shuba.com`, `xbiquge.info`, `novel543.com`, `tw.hjwzw.com`, `truyenfull` (auto nhận diện theo URL) |
| 🌍 Dịch tự động | Gemini API (`gemini-2.5-flash`…), dịch từng chương, chia chunk, prompt dịch giả văn học |
| 🔑 Quản lý API key | Thêm/xoá/voiring nhiều key Gemini trong UI; xoay vòng round-robin; tự cooldown khi 429, tự vô hiệu hoá key hỏng |
| 🏃 Chạy nền | Job queue nằm trên engine (server) — đóng tab, tắt máy tính khách, job vẫn chạy |
| 📡 Real-time | socket.io: tiến độ job, chương mới cào/dịch, log trực tiếp trên dashboard |
| ☁️ Supabase | Đồng bộ truyện + chương + key lên Supabase (push/pull) — cấu hình ngay trong UI |
| 📤 Xuất API | REST: JSON từng chương / cả truyện, tải file `.txt` |
| 🌙 Dark mode | UI tiếng Việt, responsive mobile-first |

## 🏗️ Kiến trúc

```
[Trình duyệt]
   │  REST  /api/*        socket.io  /engine-io (wss)
   ▼                                    │
[ WEB — Next.js 16 ]  ──── ENGINE_URL ──┴──▶ [ ENGINE — Bun, Docker ]
   vercel.com                                    railway.app / fly.io / VPS
   (không DB — mọi dữ liệu                       ▼
    đi qua Engine)                          [ SQLite + volume bền vững ]
```

- Deploy **Web lên Vercel**, **Engine lên Railway** (hoặc Render/Fly/VPS bất kỳ có Docker).
- Engine là *nguồn sự thật duy nhất* (SQLite + volume). Web trên Vercel chỉ proxy.
- Khi `ENGINE_URL` trỏ tới host từ xa, web tự động chuyển sang chế độ remote-engine (không cần SQLite trên Vercel).

## 🚀 Chạy local (Bun)

```bash
# 1. Web (cổng 3000)
cp .env.example .env          # để nguyên mặc định cũng chạy được
bun install
bun run db:push               # tạo SQLite + bảng

# 2. Engine (cổng 3002)
cd mini-services/engine-service
bun install
bun run dev                   # bun --hot index.ts

# 3. Mở http://localhost:3000
```

> Lấy Gemini API key tại [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → thêm trong **Cài đặt → Gemini API key**.

## 🔧 Biến môi trường

### Web (Vercel)

| Biến | Bắt buộc | Ví dụ | Ý nghĩa |
|---|---|---|---|
| `ENGINE_URL` | ✅ khi deploy | `https://khotruyen-engine.up.railway.app` | Engine public URL. Host khác localhost → tự bật remote-engine |
| `NEXT_PUBLIC_ENGINE_URL` | ✅ khi deploy | `https://khotruyen-engine.up.railway.app` | Cho socket.io client (tiền tố `NEXT_PUBLIC_` bắt buộc) |
| `DATABASE_URL` | ⬜ | `file:./db/custom.db` | Chỉ dùng chế độ local; điền giá trị bất kỳ khi deploy |
| `ENGINE_READS` | ⬜ | `remote` | Bật tường minh remote-engine (tự bật đã có `ENGINE_URL`) |

### Engine (Railway)

| Biến | Bắt buộc | Ví dụ | Ý nghĩa |
|---|---|---|---|
| `PORT` | tự động | *(platform gán)* | Cổng lắng nghe — Railway tự set |
| `ENGINE_DB` | có sẵn trong image | `/data/custom.db` | File SQLite — trỏ vào volume `/data` |

---

# ☁️ HƯỚNG DẪN DEPLOY (GitHub → Railway → Vercel)

## Bước 1 — Đẩy code lên GitHub

**1.1.** Tải toàn bộ mã nguồn về máy bạn (nút Download của workspace), giải nén.

**1.2.** Tạo repository trên GitHub:
- Vào [github.com/new](https://github.com/new)
- Repository name: `khotruyen-ai` → chọn **Private** (dữ liệu truyện cá nhân) → **Create repository**

**1.3.** Push code từ máy bạn:

```bash
cd khotruyen-ai            # thư mục mã nguồn
git remote add origin https://github.com/<tên-bạn>/khotruyen-ai.git
git branch -M main
git push -u origin main
```

> Repo đã có commit sẵn — nếu tải về mất `.git`, chạy `git init && git add . && git commit -m "KhoTruyện AI"` trước.

## Bước 2 — Triển khai Engine lên Railway

> Engine cần chạy tiến trình dài hạn + ổ cứng bền vững → **không deploy được lên Vercel**. Dùng Railway (dễ nhất, có volume), hoặc Fly.io / VPS.

**2.1.** Vào [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → chọn `khotruyen-ai`.

**2.2.** Service vừa tạo → **Settings**:
- **Root Directory** = `mini-services/engine-service`
- Railway tự nhận diện `Dockerfile` (cài Bun + `curl`, đặt `ENGINE_DB=/data/custom.db`)

**2.3.** Gắn volume để SQLite không mất khi deploy lại:
- **Variables** tab → **New** → **Volume** → **Mount path** = `/data`
- Dung lượng: 512 MB là đủ hàng nghìn chương.

**2.4.** Lấy domain công khai:
- **Settings** → **Networking** → **Generate Domain** → được ví dụ `https://khotruyen-engine.up.railway.app`

**2.5.** Kiểm tra — mở:

```
https://<engine-domain>/health
→ {"ok":true,"uptime":...,"db":"ok"}
```

<details>
<summary>💡 Host khác (Fly.io / Render / VPS)</summary>

```bash
# Fly.io — có volume miễn phí trong free allowance
fly launch --dockerfile mini-services/engine-service/Dockerfile --now
fly volumes create data --size 1
fly deploy

# VPS bất kỳ có Docker:
docker build -t khotruyen-engine mini-services/engine-service
docker run -d -p 3002:3002 -v /srv/khotruyen:/data --restart always khotruyen-engine
```
Lưu ý Render: cần **Persistent Disk** (gói trả phí) và gán `ENGINE_DB=/data/custom.db`.
</details>

## Bước 3 — Triển khai Web lên Vercel

**3.1.** Vào [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → chọn `khotruyen-ai`.

**3.2.** Cấu hình:
- Framework Preset: **Next.js** (tự nhận)
- Root Directory: `./` (mặc định)
- Build Command: `next build`
- Install Command: để mặc định (Vercel thấy `bun.lock` sẽ dùng Bun)

**3.3.** **Environment Variables** (đánh dấu cả Production + Preview):

| Name | Value |
|---|---|
| `ENGINE_URL` | `https://khotruyen-engine.up.railway.app` |
| `NEXT_PUBLIC_ENGINE_URL` | `https://khotruyen-engine.up.railway.app` |
| `DATABASE_URL` | `file:./db/custom.db` *(giá trị bất kỳ — không dùng ở remote mode)* |

**3.4.** **Deploy** → xong mở `https://<tên-bạn>.vercel.app` 🎉

> Vercel chạy `postinstall: prisma generate` tự động trong lúc build.

## Bước 4 — (Tuỳ chọn) Supabase

1. Tạo project tại [supabase.com](https://supabase.com) (miễn phí).
2. **SQL Editor** → dán schema (lấy trong app: **Cài đặt → Supabase → Xem SQL**, hoặc `GET /api/supabase/schema`) → **Run**.
3. Trong app: **Cài đặt → Supabase** → dán **Project URL** + **service_role key** (Settings → API) → **Kiểm tra kết nối** → **Đồng bộ**.

Truyện/chương/key được push lên Supabase — có thể bật **tự động đồng bộ sau khi cào xong**.

## Bước 5 — Kiểm tra sau deploy

1. Mở web trên Vercel → dashboard hiển thị thống kê, "Engine trực tuyến".
2. **Thêm truyện** → dán URL (ví dụ `https://truyenfull.live/mot-truyen-bat-ky/`) → **Xem trước** → **Bắt đầu cào**.
3. **Đóng tab** → job vẫn chạy trên Railway. Mở lại → tiến độ cập nhật real-time (socket.io).
4. Thêm Gemini key → **Dịch tự động**.
5. Đọc truyện trong trình đọc; xuất dữ liệu:

```bash
curl https://<web>/api/export/novels
curl "https://<web>/api/export/novels/<id>?lang=vi&chapters=1-5"
curl -o truyen.txt "https://<web>/api/export/novels/<id>/txt?lang=vi"
```

---

## 📤 Export API

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/export` | Tài liệu API (JSON) |
| GET | `/api/export/novels` | Danh sách truyện đã cào |
| GET | `/api/export/novels/{id}?lang=vi\|src\|both&chapters=1-100` | Truyện + chương (nội dung + bản dịch) |
| GET | `/api/export/novels/{id}/chapters/{idx}?lang=` | Một chương |
| GET | `/api/export/novels/{id}/txt?lang=vi\|src` | Tải file `.txt` |

`lang`: `vi` = bản dịch, `src` = bản gốc, `both` = cả hai.

## 🩹 Xử lý sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| Dashboard báo "Engine không trực tuyến" | `ENGINE_URL` sai / engine chưa có domain công khai. Mở `https://<engine>/health` để kiểm tra trực tiếp |
| Không có cập nhật real-time | Thiếu `NEXT_PUBLIC_ENGINE_URL` (phải build lại sau khi thêm). F12 → Console xem lỗi websocket |
| Cào 69shuba bị 403 | Engine phải chạy qua Dockerfile (có `curl`) — đừng chạy `bun index.ts` trần trên host không có curl |
| Mất dữ liệu sau khi deploy lại | Chưa gắn Volume tại `/data` trên Railway |
| Dịch đứng / key lỗi | Vào Cài đặt xem trạng thái key (429 = rate limit, engine tự chờ) |

## ⚖️ Miễn trừ trách nhiệm

Dữ liệu cào chỉ nhằm mục đích **cá nhân** (đọc ngoại tuyến, học dịch thuật). Vui lòng tôn trọng bản quyền của tác giả và trang nguồn — **không** dùng dữ liệu cho mục đích thương mại.
