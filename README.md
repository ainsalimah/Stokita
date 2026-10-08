# Stokita

**Operasional penjualan untuk jaringan toko dalam satu tempat.** Stokita adalah aplikasi full stack untuk mengelola katalog, stok per cabang, pesanan, pembayaran, tim, dan laporan dari beberapa cabang dalam satu perusahaan.

[Coba aplikasi](https://stokita-two.vercel.app) · [Lihat kode](https://github.com/ainsalimah/Stokita)

## Cara kerja jaringan

Satu `Store` mewakili perusahaan. Setiap perusahaan memiliki satu atau lebih `Branch`. SKU, informasi produk, dan harga berlaku untuk seluruh cabang perusahaan. Saldo stok, pergerakan, dan pesanan disimpan menurut cabang.

Pemilik dapat melihat ringkasan seluruh jaringan, memilih cabang aktif untuk pekerjaan operasional, menambah cabang, serta menempatkan manajer dan staf di cabang tertentu. Manajer dan staf hanya dapat bekerja pada cabang yang ditugaskan. Katalog dan harga dikelola pemilik agar tetap seragam.

## Coba demo

Buka [aplikasi Stokita](https://stokita-two.vercel.app), lalu pilih **Pemilik**, **Manajer**, atau **Staf**. Setiap klik membuat perusahaan demo pribadi selama 24 jam dengan tiga cabang, 12 produk, stok yang berbeda, serta transaksi dalam beberapa tahap. Tidak diperlukan email atau kata sandi. Data setiap pengunjung terpisah.

| Peran | Yang dapat dilakukan |
| --- | --- |
| Pemilik | Mengendalikan jaringan, cabang, katalog, harga, pengguna, laporan, dan seluruh tindakan operasional |
| Manajer | Mengawasi satu cabang, melihat laporan, mengoreksi dan mentransfer stok, membatalkan pesanan, serta memproses refund dan retur |
| Staf | Menangani pekerjaan harian berupa stok masuk, pesanan, pembayaran, dan penyelesaian transaksi |

Untuk melihat perbedaan stok, masuk sebagai Pemilik, buka **Produk**, lalu ganti **Cabang aktif** pada menu samping. Untuk mencoba pembatasan akses, keluar dan pilih Manajer atau Staf.

## Fitur utama

- **Inventaris per cabang.** Setiap perubahan menyimpan jenis, jumlah, saldo sesudahnya, alasan, dan pelaku.
- **Alur penjualan utuh.** Pesanan berjalan dari draft, konfirmasi stok, pembayaran, hingga selesai. Tunai, transfer, QRIS, dan kartu didukung.
- **Refund terkendali.** Manajer atau pemilik dapat merefund transaksi yang sudah dibayar dan stok dikembalikan secara atomik.
- **Transfer antar cabang.** Barang melewati tahap draft, dikirim, dan diterima. Saldo asal berkurang saat pengiriman dan saldo tujuan bertambah setelah penerimaan dikonfirmasi.
- **Retur setelah penjualan.** Manajer atau pemilik dapat menerima sebagian atau seluruh barang dari pesanan selesai. Stok, nilai retur, dan pendapatan bersih diperbarui dalam satu transaksi.
- **Akses sesuai peran.** Cabang dan peran ditentukan dari sesi pengguna di server. Permintaan tidak dapat memilih cabang lain melalui ID yang dikirim browser.
- **Ringkasan pusat.** Pemilik melihat pendapatan yang sudah dibayar, transaksi, tim, dan kondisi setiap cabang.
- **Excel pusat dan cabang.** Manajer dapat mengunduh laporan cabangnya. Pemilik juga dapat mengunduh laporan seluruh jaringan. Status pembayaran dan metode pembayaran tercantum di dalamnya.
- **Demo pribadi.** Setiap pengunjung mendapat ruang demo yang terpisah dan dibersihkan setelah masa berlaku.

## Teknologi

| Area | Teknologi |
| --- | --- |
| Antarmuka | React, TypeScript, Vite, dan CSS |
| API | Node.js, Express, TypeScript, dan Zod |
| Data | PostgreSQL di Neon, Prisma, dan migrasi SQL |
| Laporan | ExcelJS |
| Publikasi | Vercel |

## Jalankan lokal

1. Siapkan Node.js 22 atau lebih baru dan PostgreSQL.
2. Salin `.env.example` ke `.env`. Isi `DATABASE_URL` dan `DIRECT_URL` untuk database pengembangan. Kedua URL harus menuju database yang sama. Simpan kata sandinya di luar repositori.
3. Jalankan `npm install`, lalu `npm run db:deploy`.
4. Jalankan `npm run dev` dan buka `http://localhost:3001`.

Tombol demo membuat datanya sendiri. Untuk membuat akun pengujian tetap, isi `SEED_DEMO_PASSWORD` dengan sedikitnya 12 karakter, lalu jalankan `npm run db:seed`. Seed menyediakan tiga cabang. Seed dapat dijalankan lagi tanpa mengatur ulang saldo stok yang sudah berubah.

## Pengujian

- `npm test` memeriksa aturan status pesanan dan format laporan Excel.
- `npm run typecheck` dan `npm run build` memeriksa aplikasi dan API.
- `npm run test:demo:integration` menguji demo pribadi dan batas akses. Jalankan server lokal terlebih dahulu.
- `TEST_DEMO_PASSWORD` harus sama dengan `SEED_DEMO_PASSWORD` saat menjalankan `npm run test:integration`. Pengujian ini memakai akun seed pada database pengembangan dan membuat produk serta pesanan uji.

Pengujian integrasi memeriksa pemisahan stok dan pesanan antar cabang, akses peran, persaingan dua konfirmasi atas stok terakhir, pengulangan konfirmasi dan pembatalan, serta unduhan Excel pusat.

## Migrasi dari versi satu toko

Migrasi `20261008090000_multi_branch` membuat **Cabang Utama** untuk setiap perusahaan yang sudah ada. Saldo stok produk lama dipindahkan ke `BranchInventory` pada cabang tersebut. Pesanan, pergerakan stok, audit log, pengguna manajer dan staf, serta sesi lama ditautkan ke cabang yang sama. ID produk, pesanan, pengguna, dan perusahaan tetap dipertahankan.

Migrasi `20261008170000_order_payments` menambahkan status dan metode pembayaran. Pesanan lama yang sudah selesai ditandai sudah dibayar dengan metode tunai agar nilai historis tetap masuk laporan. Pesanan lama yang masih dikonfirmasi tetap menunggu pembayaran.

Migrasi `20261008190000_transfers_returns` menambahkan transfer stok, retur penjualan, nilai retur pada pesanan, serta status pembayaran retur sebagian. Data lama tetap memiliki nilai retur nol.

Sebelum migrasi produksi, buat snapshot database. Jalankan `npm run db:deploy` dengan `DIRECT_URL` produksi, lalu terbitkan aplikasi versi baru. Migrasi harus selesai sebelum API baru menerima permintaan. Jalankan pengujian pada salinan database terlebih dahulu.

## Aturan data dan akses

- SKU unik dalam satu perusahaan. Harga pada item pesanan disalin saat draft dibuat sehingga perubahan harga katalog tidak mengubah pesanan lama.
- Stok tidak boleh negatif. Penambahan, pengurangan, pergerakan stok, dan perubahan status pesanan memakai transaksi dengan isolasi `Serializable`.
- `OWNER` dapat mengganti cabang aktif pada sesinya. `MANAGER` dan `STAFF` selalu memakai cabang yang ditugaskan. Pemindahan pengguna ke cabang lain mengakhiri sesi lamanya.
- Pesanan `DRAFT` dapat dikonfirmasi untuk mereservasi stok. Pesanan `CONFIRMED` harus dibayar sebelum diselesaikan.
- Pesanan terkonfirmasi yang belum dibayar dapat dibatalkan manajer atau pemilik. Pesanan terkonfirmasi yang sudah dibayar dapat direfund oleh peran yang sama.
- Pendapatan menghitung nilai bersih pesanan `PAID` dan `PARTIALLY_REFUNDED`. Transaksi `UNPAID` dan nilai yang sudah diretur tidak masuk pendapatan.
- Pesanan selesai dapat memiliki beberapa retur selama jumlah total setiap produk tidak melebihi jumlah yang dijual. Pendapatan dikurangi berdasarkan nilai barang yang sudah diretur.
- Staf dapat mencatat stok masuk. Koreksi stok hanya tersedia untuk manajer dan pemilik.
- Transfer stok hanya dikelola manajer dan pemilik. Pengiriman harus dilakukan dari cabang asal dan penerimaan harus dikonfirmasi dari cabang tujuan.
- Data perusahaan lain tetap terpisah. Setiap akses produk, cabang, stok, dan pesanan diperiksa terhadap perusahaan dari sesi.

## API

Semua endpoint memakai awalan `/api`. Selain login, demo, dan health, endpoint memerlukan sesi.

| Metode | Endpoint | Fungsi |
| --- | --- | --- |
| POST | `/auth/login`, `/auth/demo`, `/auth/logout` | Masuk, mulai demo, dan keluar |
| GET | `/auth/me` | Akun dan cabang aktif |
| PATCH | `/auth/active-branch` | Pemilik memilih cabang aktif |
| GET, POST, PATCH | `/branches`, `/branches/:id` | Daftar, tambah, dan ubah cabang |
| GET, POST, PATCH | `/users`, `/users/:id` | Kelola pengguna dan penempatan cabang |
| GET, POST, PATCH | `/products`, `/products/:id` | Katalog bersama, perubahan khusus pemilik |
| GET, POST | `/stock-movements` | Riwayat dan perubahan stok cabang |
| GET, POST | `/transfers` | Daftar dan draft transfer stok |
| POST | `/transfers/:id/send`, `/transfers/:id/receive`, `/transfers/:id/cancel` | Pengiriman, penerimaan, dan pembatalan transfer |
| GET, POST | `/orders` | Daftar dan buat pesanan cabang |
| POST | `/orders/:id/confirm`, `/orders/:id/cancel`, `/orders/:id/fulfill` | Konfirmasi, pembatalan, dan penyelesaian pesanan |
| POST | `/orders/:id/pay`, `/orders/:id/refund` | Pencatatan pembayaran dan refund |
| POST | `/orders/:id/returns` | Retur sebagian atau penuh setelah pesanan selesai |
| GET | `/dashboard`, `/reports/summary` | Ringkasan sesuai peran |
| GET | `/reports/orders.xlsx`, `/reports/network.xlsx` | Excel cabang dan seluruh jaringan |

## Publikasi

Frontend Vite dan API Express berjalan pada satu project Vercel. Neon menyimpan PostgreSQL. Atur `DATABASE_URL` untuk koneksi pooled dan `DIRECT_URL` untuk migrasi. Jalankan migrasi sebelum menerbitkan build baru, lalu periksa `/api/health`, masuk demo, stok, pesanan, dan laporan Excel.
