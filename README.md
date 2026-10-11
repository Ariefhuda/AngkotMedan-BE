# AngkotMedan-BE

API pencari rute angkot Kota Medan. Menyimpan data trayek dan halte di PostgreSQL, lalu menjawab pertanyaan "dari titik ini ke titik itu naik angkot apa".

Ini backend untuk [AngkotMedan-FE](https://github.com/Ariefhuda/AngkotMedan-FE). Versi situs yang berjalan tanpa backend ada di [AngkotMedan](https://github.com/Ariefhuda/AngkotMedan).

## Teknologi

- Node.js dan Express 5
- Prisma 6 dengan PostgreSQL

## Menjalankan

Butuh Node.js 20 ke atas dan PostgreSQL. Kalau belum punya PostgreSQL, `docker-compose.yml` di repo ini menyediakannya.

```bash
git clone https://github.com/Ariefhuda/AngkotMedan-BE.git
cd AngkotMedan-BE
cp .env.example .env
docker compose up -d      # lewati kalau sudah punya PostgreSQL sendiri
npm install
npm run db:push           # membuat tabel
npm run db:seed           # mengisi 118 trayek dan 190 halte
npm run dev
```

API berjalan di http://localhost:3001.

Isi `.env`:

| Variabel | Isi |
|---|---|
| `DATABASE_URL` | alamat PostgreSQL |
| `PORT` | port API, bawaan 3001 |

## Endpoint

Semua jawaban berbentuk JSON.

| Method | Alamat | Kegunaan |
|---|---|---|
| GET | `/` | cek API hidup |
| GET | `/api/search?q=usu` | cari halte dari nama, minimal 2 huruf, paling banyak 10 hasil |
| GET | `/api/routes` | semua trayek beserta haltenya |
| GET | `/api/routes?lat=..&lng=..&radius=500` | trayek yang lewat dalam radius (meter) dari satu titik |
| GET | `/api/routes/:code` | satu trayek, misalnya `/api/routes/R001` |
| GET | `/api/navigate?from_lat=..&from_lng=..&to_lat=..&to_lng=..` | cari rute dari satu titik ke titik lain |

Parameter yang kosong atau bukan angka dijawab `400`. Kode trayek yang tidak ada dijawab `404`.

### Contoh `/api/navigate`

```
GET /api/navigate?from_lat=3.5613&from_lng=98.6568&to_lat=3.5493&to_lng=98.7167
```

```json
{
  "transfers": 0,
  "routes": [
    {
      "type": "direct",
      "route": { "code": "R077", "number": "135", "operator": "Medan Bus", "color": "Biru" },
      "boardStop": { "name": "USU" },
      "alightStop": { "name": "Amplas" },
      "intermediateStops": [{ "name": "Padang Bulan" }],
      "totalStops": 2
    }
  ]
}
```

Contoh di atas diringkas. Jawaban aslinya memuat semua kolom trayek dan koordinat tiap halte.

Kalau tidak ada rute langsung, `routes` berisi rute dengan satu kali pindah (`"type": "transfer"`), masing-masing punya `leg1` dan `leg2` dengan bentuk yang sama seperti rute langsung. Paling banyak tiga rute dikembalikan. Kalau tidak ada rute sama sekali, `routes` kosong.

## Cara rute dicari

1. Ambil paling banyak lima halte dalam jarak 1 km dari titik asal, begitu juga dari titik tujuan.
2. Rute langsung: trayek yang melewati salah satu halte asal dan salah satu halte tujuan. Trayek satu arah hanya dihitung kalau arahnya benar.
3. Kalau tidak ada rute langsung, cari dua trayek yang bertemu di satu halte.
4. Urutan hasil dihitung dari jumlah halte ditambah jarak jalan kaki. Jalan kaki 200 meter dihitung setara satu halte.

Asal dan tujuan yang berjarak kurang dari 300 meter dijawab tanpa rute.

## Data

- `data/trayek_angkot_medan.csv`: 118 trayek dengan urutan haltenya.
- `data/stop_coords.json`: koordinat halte.

`npm run db:seed` boleh dijalankan berulang kali. Trayek dan halte yang sudah ada diperbarui, tidak digandakan.

Kolom `code` di tabel `Route` memakai kolom `id` dari CSV (`R001` dan seterusnya), bukan nomor angkot, karena dua operator bisa memakai nomor yang sama.

## Susunan berkas

```
src/index.js               server Express
src/routes/angkot.js       daftar endpoint dan pemeriksaan parameter
src/controllers/angkot.js  query database dan pencarian rute
prisma/schema.prisma       tabel Route, Stop, RouteStop
prisma/seed.js             pengisi data dari folder data/
data/                      CSV trayek dan koordinat halte
docker-compose.yml         PostgreSQL untuk pengembangan
```

## Keterbatasan

- Rute dengan dua kali pindah belum dicari.
- Beberapa tempat tercatat dengan lebih dari satu nama (misalnya "Belawan" dan "T. Belawan") dan diperlakukan sebagai halte berbeda.
- Belum ada tes otomatis.
