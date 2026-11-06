# ZAWA SMART COMPETITION backend

Backend Hono + SQLite untuk state `lcc-local-state-v1` milik frontend. Browser
tetap menyimpan cache di `localStorage`; backend menyediakan penyimpanan bersama
antarperangkat dan mengirim perubahan state melalui WebSocket, tanpa polling.

## Menjalankan

```sh
npm install
npm run dev
```

Server berjalan di `http://localhost:3000`. Data SQLite dibuat di
`data/zawa.sqlite` dan bertahan setelah server dimulai ulang. Konfigurasi:

| Variabel | Default | Kegunaan |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP |
| `HOST` | `127.0.0.1` | Alamat bind; ubah hanya jika server perlu diakses perangkat lain |
| `SQLITE_PATH` | `./data/zawa.sqlite` | Lokasi file database |
| `FRONTEND_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Origin frontend yang diizinkan, dipisahkan koma |

Frontend Vite menggunakan backend lokal secara default. Untuk backend di alamat
lain, set `VITE_API_URL` ke base URL API, misalnya `https://api.example.test/api`,
sebelum menjalankan atau membangun frontend.

## API

- `GET /health` — pemeriksaan kesehatan.
- `GET /api/state` — state lengkap beserta `revision`.
- `PUT /api/state` — simpan state lengkap memakai `expectedRevision` untuk
  mencegah perubahan klien lain tertimpa. Konflik mengembalikan HTTP 409 dan
  snapshot terbaru.
- `GET /api/teams` dan `GET /api/questions` — baca koleksi domain.
- `POST /api/buzzer` — klaim buzzer secara atomik; hanya satu tim yang dapat
  menang pada satu babak. Body: `{"teamId":"..."}`.
- `GET /api/ws` — WebSocket yang mengirim `{ "type": "state", "revision": 1,
  "state": { ... } }` pada koneksi dan setiap perubahan berhasil.

State mengikuti skema frontend: `version`, `teams`, `questions`,
`currentQuestionId`, `rebuttalOpen`, `buzzerTeamId`, `screen`, dan `updatedAt`.
Backend memvalidasi referensi, batas ukuran, nilai skor, serta tipe data sebelum
menulis ke SQLite. Backend dan frontend menggunakan satu database/kompetisi
bersama; autentikasi admin belum tersedia. Jangan mengekspos server ke internet
atau jaringan yang tidak tepercaya tanpa menambahkan autentikasi dan HTTPS.

## Pengujian

```sh
npm test
```