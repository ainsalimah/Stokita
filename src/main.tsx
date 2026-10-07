import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, ClipboardList, ArrowDownUp, Users, BarChart3, LogOut, Plus, Search, Menu, X, Download, ChevronLeft, ChevronRight, ShieldCheck, Store, AlertCircle, CheckCircle2 } from 'lucide-react'
import './style.css'
import './dashboard.css'

type Role = 'OWNER' | 'MANAGER' | 'STAFF'
type User = { id: string; name: string; email: string; role: Role; active?: boolean }
type Product = { id: string; sku: string; name: string; category: string | null; price: number; stock: number; minStock: number; active: boolean }
type OrderItem = { id: string; productId: string; quantity: number; unitPrice: number; product: { name: string; sku: string } }
type Order = { id: string; number: string; customerName: string; status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'; total: number; createdAt: string; items: OrderItem[] }
type Movement = { id: string; type: string; quantity: number; balanceAfter: number; reason: string; createdAt: string; product: { name: string; sku: string }; user: { name: string } }
type Summary = { products: number; lowStock: number; orders: number; confirmed: number; revenue: number; recent: { id: string; action: string; entity: string; createdAt: string; user: { name: string } }[] }
type RecentActivity = Summary['recent'][number]
type LowStockProduct = Pick<Product, 'id' | 'name' | 'sku' | 'stock' | 'minStock'>
type OwnerDashboard = { role: 'OWNER'; products: number; lowStock: number; orders: number; confirmed: number; revenue: number; activeUsers: number; recent: RecentActivity[] }
type ManagerDashboard = { role: 'MANAGER'; lowStock: number; lowStockProducts: LowStockProduct[]; draftOrders: number; confirmedOrders: number; recent: RecentActivity[] }
type StaffDashboard = { role: 'STAFF'; lowStock: number; lowStockProducts: LowStockProduct[]; draftOrders: number; confirmedOrders: number; queue: Pick<Order, 'id' | 'number' | 'customerName' | 'status' | 'createdAt'>[] }
type DashboardData = OwnerDashboard | ManagerDashboard | StaffDashboard
type PageData<T> = { items: T[]; total: number; page: number; limit: number }

const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const roleText: Record<Role, string> = { OWNER: 'Pemilik', MANAGER: 'Manajer', STAFF: 'Staf' }
const statusText: Record<Order['status'], string> = { DRAFT: 'Draft', CONFIRMED: 'Dikonfirmasi', FULFILLED: 'Selesai', CANCELLED: 'Dibatalkan' }

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers }, ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.details?.length ? `${body.error} ${body.details.map((x: { field: string; message: string }) => `${x.field}: ${x.message}`).join('; ')}` : body.error || 'Permintaan gagal.')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function useData<T>(url: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let live = true; setLoading(true); setError(''); api<T>(url).then(x => { if (live) setData(x) }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [url, refresh])
  return { data, loading, error }
}

function Notice({ message, tone = 'error' }: { message: string; tone?: 'error' | 'success' }) {
  return message ? <div role="alert" className={`notice ${tone}`}>{tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}{message}</div> : null
}
function Empty({ title, detail }: { title: string; detail?: string }) { return <div className="empty"><Package size={34} strokeWidth={1.4} /><strong>{title}</strong><span>{detail}</span></div> }
function Loading() { return <div className="loading">Memuat data…</div> }
function Pager({ page, total, limit, onChange }: { page: number; total: number; limit: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit))
  return <div className="pager"><span>{total} data • Halaman {page} dari {pages}</span><div><button className="icon-button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={18}/></button><button className="icon-button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Halaman berikutnya"><ChevronRight size={18}/></button></div></div>
}
function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div> }

function Login({ onLogin }: { onLogin: (user: User, store: { name: string }) => void }) {
  const [email, setEmail] = useState('owner@tokomaju.demo')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const result = await api<{ user: User; store: { name: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); onLogin(result.user, result.store) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <div className="login-shell"><div className="login-story"><div className="brand large"><span className="brand-mark"><Package size={25}/></span><span>stokita<span className="brand-dot">.</span></span></div><div className="story-content"><span className="story-tag">OPERASI TOKO, LEBIH TERARAH</span><h1>Stok akurat.<br/>Pesanan lancar.<br/><em>Keputusan lebih pasti.</em></h1><p>Satu tempat untuk memantau produk, pergerakan stok, dan pesanan di toko Anda.</p><div className="story-stat"><strong>01</strong><span>Alur kerja yang jelas, dari barang masuk hingga pesanan selesai.</span></div></div><div className="story-footer">STOKITA / INVENTORY OPERATIONS</div></div><div className="login-side"><form className="login-card" onSubmit={submit}><div className="mobile-brand brand"><span className="brand-mark"><Package size={20}/></span>stokita<span className="brand-dot">.</span></div><div className="login-icon"><ShieldCheck size={25}/></div><p className="eyebrow">SELAMAT DATANG KEMBALI</p><h2>Masuk ke ruang kerja</h2><p className="muted">Kelola operasional toko dengan lebih tenang.</p><Notice message={error}/><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/></label><label>Kata sandi<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Masukkan kata sandi"/></label><button className="button primary full" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button><p className="login-help">Gunakan akun demo yang tercantum di README proyek.</p></form></div></div>
}

const nav = [{ to: '/', label: 'Ringkasan', icon: LayoutDashboard }, { to: '/products', label: 'Produk', icon: Package }, { to: '/stock', label: 'Pergerakan stok', icon: ArrowDownUp }, { to: '/orders', label: 'Pesanan', icon: ClipboardList }, { to: '/reports', label: 'Laporan', icon: BarChart3 }, { to: '/users', label: 'Pengguna', icon: Users }]
function Shell({ user, store, onLogout }: { user: User; store: { name: string }; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  return <div className="app-shell"><aside className={`sidebar ${open ? 'open' : ''}`}><div className="sidebar-top"><div className="brand"><span className="brand-mark"><Package size={21}/></span>stokita<span className="brand-dot">.</span></div><button className="mobile-close icon-button" onClick={() => setOpen(false)} aria-label="Tutup menu"><X size={20}/></button></div><div className="workspace"><div className="workspace-icon"><Store size={20}/></div><div><small>RUANG KERJA</small><strong>{store.name}</strong></div></div><div className="nav-label">MENU UTAMA</div><nav>{nav.filter(item => item.to !== '/users' || user.role === 'OWNER').map(item => <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={19}/>{item.label}</NavLink>)}</nav><div className="sidebar-bottom"><div className="profile"><div className="avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><small>{roleText[user.role]}</small></div></div><button className="nav-item logout" onClick={onLogout}><LogOut size={18}/>Keluar</button></div></aside><div className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu size={22}/></button><div className="breadcrumb">Workspace <span>/</span> {store.name}</div><div className="topbar-right"><span className="live-dot"/>Sistem aktif <span className="topbar-sep"/> {user.name}</div></header><main className="content"><Routes><Route path="/" element={<Dashboard role={user.role}/>}/><Route path="/products" element={<Products role={user.role}/>}/><Route path="/stock" element={<Stock/>}/><Route path="/orders" element={<Orders/>}/><Route path="/reports" element={<Reports/>}/><Route path="/users" element={user.role === 'OWNER' ? <UsersPage/> : <Navigate to="/"/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes></main></div>{open && <div className="scrim" onClick={() => setOpen(false)}/>}</div>
}

function ActivityPanel({ items }: { items: RecentActivity[] }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">JEJAK AKTIVITAS</p><h2>Aktivitas terbaru</h2></div></div>{items.length ? <div className="activity-list">{items.map(item => <div className="activity" key={item.id}><span className="activity-icon"><ArrowDownUp size={17}/></span><div><strong>{item.user.name} • {item.action.toLowerCase()} {item.entity.toLowerCase()}</strong><small>{date(item.createdAt)}</small></div></div>)}</div> : <Empty title="Belum ada aktivitas" detail="Aktivitas toko akan tampil di sini."/>}</section>
}

function LowStockPanel({ items, onOpen }: { items: LowStockProduct[]; onOpen: () => void }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PERLU PERHATIAN</p><h2>Produk stok menipis</h2></div><button className="text-button" onClick={onOpen}>Lihat produk</button></div>{items.length ? <div className="dashboard-list">{items.map(item => <div className="dashboard-row" key={item.id}><div><strong>{item.name}</strong><small>{item.sku}</small></div><span className="stock-value low">{item.stock} / batas {item.minStock}</span></div>)}</div> : <Empty title="Stok aman" detail="Belum ada produk di bawah batas minimum."/>}</section>
}

function Dashboard({ role }: { role: Role }) {
  const { data, loading, error } = useData<DashboardData>('/dashboard')
  const navigate = useNavigate()
  if (loading) return <><SectionHeader eyebrow="RUANG KERJA" title="Ringkasan toko" description="Memuat informasi toko Anda."/><Loading/></>
  if (error || !data) return <><SectionHeader eyebrow="RUANG KERJA" title="Ringkasan toko" description="Informasi toko belum tersedia."/><Notice message={error || 'Dashboard belum dapat dimuat.'}/></>
  if (data.role !== role) return <Notice message="Sesi berubah. Muat ulang halaman untuk melihat dashboard terbaru."/>

  if (data.role === 'OWNER') return <>
    <SectionHeader eyebrow="UNTUK PEMILIK" title="Kondisi toko" description="Pantau kinerja dan tim toko dalam satu tempat."/>
    <div className="dashboard-actions"><button className="button primary" onClick={() => navigate('/reports')}><BarChart3 size={18}/> Lihat laporan</button><button className="button subtle" onClick={() => navigate('/users')}><Users size={18}/> Kelola pengguna</button></div>
    <div className="dashboard-stats">
      <div className="stat-card"><span>Produk aktif</span><strong>{data.products}</strong><small>Dalam katalog</small><Package size={23}/></div>
      <div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Perlu perhatian</small><AlertCircle size={23}/></div>
      <div className="stat-card"><span>Total pesanan</span><strong>{data.orders}</strong><small>{data.confirmed} dikonfirmasi / selesai</small><ClipboardList size={23}/></div>
      <div className="stat-card highlight"><span>Nilai pesanan aktif</span><strong className="money-stat">{money(data.revenue)}</strong><small>Dikonfirmasi & selesai</small><BarChart3 size={23}/></div>
      <div className="stat-card"><span>Pengguna aktif</span><strong>{data.activeUsers}</strong><small>Tim toko yang dapat masuk</small><Users size={23}/></div>
    </div>
    <div className="dashboard-panels"><ActivityPanel items={data.recent}/><section className="quick-panel"><p className="eyebrow">LANGKAH BERIKUTNYA</p><h2>Ambil keputusan dari data toko.</h2><p>Periksa pesanan dan stok sebelum merencanakan langkah berikutnya.</p><button onClick={() => navigate('/orders')}>Lihat pesanan <ChevronRight size={18}/></button><button onClick={() => navigate('/products')}>Lihat produk <ChevronRight size={18}/></button></section></div>
  </>

  if (data.role === 'MANAGER') return <>
    <SectionHeader eyebrow="UNTUK MANAJER" title="Operasional toko" description="Prioritaskan stok dan pesanan yang perlu ditangani."/>
    <div className="dashboard-actions"><button className="button primary" onClick={() => navigate('/products')}><Package size={18}/> Kelola produk</button><button className="button subtle" onClick={() => navigate('/stock')}><ArrowDownUp size={18}/> Lihat stok</button><button className="button subtle" onClick={() => navigate('/orders')}><ClipboardList size={18}/> Lihat pesanan</button></div>
    <div className="dashboard-stats">
      <div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Produk perlu perhatian</small><AlertCircle size={23}/></div>
      <div className="stat-card"><span>Pesanan draft</span><strong>{data.draftOrders}</strong><small>Menunggu konfirmasi</small><ClipboardList size={23}/></div>
      <div className="stat-card"><span>Pesanan dikonfirmasi</span><strong>{data.confirmedOrders}</strong><small>Menunggu penyelesaian</small><CheckCircle2 size={23}/></div>
    </div>
    <div className="dashboard-panels"><LowStockPanel items={data.lowStockProducts} onOpen={() => navigate('/products')}/><ActivityPanel items={data.recent}/></div>
  </>

  return <>
    <SectionHeader eyebrow="UNTUK STAF" title="Pekerjaan toko" description="Lihat antrean pesanan dan stok yang perlu diperhatikan."/>
    <div className="dashboard-actions"><button className="button primary" onClick={() => navigate('/orders?new=1')}><Plus size={18}/> Buat pesanan</button><button className="button subtle" onClick={() => navigate('/stock?new=1')}><ArrowDownUp size={18}/> Catat stok</button></div>
    <div className="dashboard-stats">
      <div className="stat-card"><span>Pesanan draft</span><strong>{data.draftOrders}</strong><small>Perlu dikonfirmasi</small><ClipboardList size={23}/></div>
      <div className="stat-card"><span>Pesanan dikonfirmasi</span><strong>{data.confirmedOrders}</strong><small>Perlu diselesaikan</small><CheckCircle2 size={23}/></div>
      <div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Perlu diperhatikan</small><AlertCircle size={23}/></div>
    </div>
    <div className="dashboard-panels"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ANTREAN TOKO</p><h2>Pesanan yang perlu ditangani</h2></div><button className="text-button" onClick={() => navigate('/orders')}>Lihat semua</button></div>{data.queue.length ? <div className="dashboard-list">{data.queue.map(order => <div className="dashboard-row" key={order.id}><div><strong>{order.number}</strong><small>{order.customerName} • {date(order.createdAt)}</small></div><span className={`badge status-${order.status.toLowerCase()}`}>{statusText[order.status]}</span></div>)}</div> : <Empty title="Antrean kosong" detail="Belum ada pesanan yang perlu ditangani."/>}</section><LowStockPanel items={data.lowStockProducts} onOpen={() => navigate('/products')}/></div>
  </>
}

function Products({ role }: { role: Role }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0), [show, setShow] = useState(false), [editing, setEditing] = useState<Product | null>(null), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Product>>(`/products?page=${page}&limit=10&search=${encodeURIComponent(query)}`, refresh)
  const [form, setForm] = useState({ sku: '', name: '', category: '', price: 0, minStock: 5, active: true })
  function openForm(product?: Product) { setEditing(product || null); setForm(product ? { sku: product.sku, name: product.name, category: product.category || '', price: product.price, minStock: product.minStock, active: product.active } : { sku: '', name: '', category: '', price: 0, minStock: 5, active: true }); setShow(true); setError(''); setSuccess('') }
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api(`/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) }); setShow(false); setRefresh(x => x + 1); setSuccess(editing ? 'Produk diperbarui.' : 'Produk ditambahkan.') } catch (e) { setError((e as Error).message) } }
  return <><SectionHeader eyebrow="KATALOG" title="Produk" description="Kelola informasi produk dan pantau jumlah stok." action={role !== 'STAFF' && <button className="button primary" onClick={() => openForm()}><Plus size={18}/> Tambah produk</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>{editing ? 'Ubah produk' : 'Tambah produk baru'}</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save} className="form-grid"><label>SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required maxLength={40}/></label><label>Nama produk<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/></label><label>Kategori<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label><label>Harga (Rp)<input type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} required/></label><label>Batas stok minimum<input type="number" min="0" value={form.minStock} onChange={e => setForm({ ...form, minStock: Number(e.target.value) })} required/></label><label>Status<select value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan produk</button></div></form></div>}<div className="panel"><div className="table-toolbar"><form className="search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search) }}><Search size={18}/><input placeholder="Cari nama atau SKU…" value={search} onChange={e => setSearch(e.target.value)}/><button type="submit">Cari</button></form><span className="table-count">{data?.total || 0} produk</span></div>{loading ? <Loading/> : !data?.items.length ? <Empty title="Produk belum ditemukan" detail="Tambahkan produk pertama atau ubah pencarian Anda."/> : <><div className="table-wrap"><table className="responsive-table product-table"><thead><tr><th>PRODUK</th><th>KATEGORI</th><th>HARGA</th><th>STOK</th><th>STATUS</th>{role !== 'STAFF' && <th>AKSI</th>}</tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td>{item.category || '—'}</td><td>{money(item.price)}</td><td><span className={`stock-value ${item.stock <= item.minStock ? 'low' : ''}`}>{item.stock}</span></td><td><span className={`badge ${item.active ? 'ok' : 'neutral'}`}>{item.active ? 'Aktif' : 'Nonaktif'}</span></td>{role !== 'STAFF' && <td><button className="text-button" onClick={() => openForm(item)}>Ubah</button></td>}</tr>)}</tbody></table></div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div></>
}

function Stock() {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [show, setShow] = useState(() => new URLSearchParams(window.location.search).has('new')), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Movement>>(`/stock-movements?page=${page}&limit=10`, refresh)
  const products = useData<PageData<Product>>('/products?limit=100', refresh)
  const [form, setForm] = useState({ productId: '', type: 'IN', quantity: 1, reason: '' })
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api('/stock-movements', { method: 'POST', body: JSON.stringify(form) }); setShow(false); setForm({ productId: '', type: 'IN', quantity: 1, reason: '' }); setRefresh(x => x + 1); setSuccess('Pergerakan stok dicatat.') } catch (e) { setError((e as Error).message) } }
  return <><SectionHeader eyebrow="INVENTARIS" title="Pergerakan stok" description="Setiap perubahan stok tercatat dan dapat ditelusuri." action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Catat stok</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>Catat pergerakan</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save} className="form-grid"><label>Produk<select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required><option value="">Pilih produk</option>{products.data?.items.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name} — stok {x.stock}</option>)}</select></label><label>Jenis<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, quantity: e.target.value === 'IN' ? 1 : 0 })}><option value="IN">Stok masuk</option><option value="ADJUSTMENT">Koreksi stok (+ / −)</option></select></label><label>Perubahan jumlah<input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} required/></label><label>Alasan<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required placeholder="Contoh: kiriman pemasok"/></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan catatan</button></div></form></div>}<div className="panel">{loading ? <Loading/> : !data?.items.length ? <Empty title="Belum ada pergerakan stok" detail="Catat barang masuk untuk mulai mengisi stok."/> : <><div className="table-wrap"><table className="responsive-table stock-table"><thead><tr><th>TANGGAL</th><th>PRODUK</th><th>JENIS</th><th>PERUBAHAN</th><th>SALDO</th><th>ALASAN / OLEH</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{date(item.createdAt)}</td><td><strong>{item.product.name}</strong><small>{item.product.sku}</small></td><td><span className="badge neutral">{({ IN: 'Masuk', ADJUSTMENT: 'Koreksi', SALE: 'Penjualan', RETURN: 'Pengembalian' } as Record<string, string>)[item.type]}</span></td><td><strong className={item.quantity < 0 ? 'negative' : 'positive'}>{item.quantity > 0 ? '+' : ''}{item.quantity}</strong></td><td>{item.balanceAfter}</td><td>{item.reason}<small>{item.user.name}</small></td></tr>)}</tbody></table></div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div></>
}

function Orders() {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState(''), [refresh, setRefresh] = useState(0), [show, setShow] = useState(() => new URLSearchParams(window.location.search).has('new')), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Order>>(`/orders?page=${page}&limit=10&search=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`, refresh)
  const products = useData<PageData<Product>>('/products?limit=100')
  const [customerName, setCustomerName] = useState(''), [lines, setLines] = useState([{ productId: '', quantity: 1 }])
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api('/orders', { method: 'POST', body: JSON.stringify({ customerName, items: lines }) }); setShow(false); setCustomerName(''); setLines([{ productId: '', quantity: 1 }]); setRefresh(x => x + 1); setSuccess('Draft pesanan dibuat.') } catch (e) { setError((e as Error).message) } }
  async function action(order: Order, kind: 'confirm' | 'cancel' | 'fulfill') { const label = { confirm: 'mengonfirmasi', cancel: 'membatalkan', fulfill: 'menyelesaikan' }[kind]; if (!window.confirm(`Yakin ingin ${label} pesanan ${order.number}?`)) return; setBusy(order.id); setError(''); setSuccess(''); try { await api(`/orders/${order.id}/${kind}`, { method: 'POST' }); setRefresh(x => x + 1); setSuccess(`Pesanan berhasil ${label}.`) } catch (e) { setError((e as Error).message) } finally { setBusy('') } }
  return <><SectionHeader eyebrow="PENJUALAN" title="Pesanan" description="Buat draft, pastikan stok, dan selesaikan pesanan." action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Pesanan baru</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>Buat draft pesanan</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save}><div className="form-grid"><label>Nama pelanggan<input value={customerName} onChange={e => setCustomerName(e.target.value)} required/></label></div><div className="line-heading">ITEM PESANAN</div>{lines.map((line, index) => <div className="order-line" key={index}><label>Produk<select value={line.productId} onChange={e => setLines(lines.map((x, i) => i === index ? { ...x, productId: e.target.value } : x))} required><option value="">Pilih produk</option>{products.data?.items.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name} — {money(x.price)} (stok {x.stock})</option>)}</select></label><label>Jumlah<input type="number" min="1" value={line.quantity} onChange={e => setLines(lines.map((x, i) => i === index ? { ...x, quantity: Number(e.target.value) } : x))} required/></label><button type="button" className="icon-button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))} aria-label="Hapus item"><X size={18}/></button></div>)}<button type="button" className="text-button add-line" onClick={() => setLines([...lines, { productId: '', quantity: 1 }])}>+ Tambah item</button><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan draft</button></div></form></div>}<div className="panel"><div className="table-toolbar"><form className="search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search) }}><Search size={18}/><input placeholder="Cari nomor atau pelanggan…" value={search} onChange={e => setSearch(e.target.value)}/><button type="submit">Cari</button></form><select className="filter-select" value={status} onChange={e => { setPage(1); setStatus(e.target.value) }}><option value="">Semua status</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Dikonfirmasi</option><option value="FULFILLED">Selesai</option><option value="CANCELLED">Dibatalkan</option></select></div>{loading ? <Loading/> : !data?.items.length ? <Empty title="Pesanan belum ditemukan" detail="Buat pesanan pertama atau ubah filter Anda."/> : <><div className="order-list">{data.items.map(order => <article className="order-card" key={order.id}><div className="order-main"><div><strong>{order.number}</strong><p>{order.customerName} <span>•</span> {date(order.createdAt)}</p></div><span className={`badge status-${order.status.toLowerCase()}`}>{statusText[order.status]}</span></div><div className="order-detail"><div>{order.items.map(item => `${item.product.name} × ${item.quantity}`).join(' · ')}</div><strong>{money(order.total)}</strong></div><div className="order-actions">{order.status === 'DRAFT' && <button className="button small primary" disabled={busy === order.id} onClick={() => action(order, 'confirm')}>Konfirmasi</button>}{order.status === 'CONFIRMED' && <><button className="button small primary" disabled={busy === order.id} onClick={() => action(order, 'fulfill')}>Tandai selesai</button><button className="button small subtle" disabled={busy === order.id} onClick={() => action(order, 'cancel')}>Batalkan</button></>}</div></article>)}</div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div></>
}

function Reports() {
  const { data, loading, error } = useData<Summary>('/reports/summary')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function download() {
    setDownloading(true)
    setDownloadError('')
    try {
      const response = await fetch('/api/reports/orders.xlsx')
      if (!response.ok) throw new Error('Laporan belum dapat diunduh. Silakan coba lagi.')
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = 'laporan-pesanan.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (cause) {
      setDownloadError((cause as Error).message)
    } finally {
      setDownloading(false)
    }
  }
  return <><SectionHeader eyebrow="ANALISIS" title="Laporan" description="Lihat angka utama dan unduh data pesanan toko." action={<button className="button primary" onClick={download} disabled={downloading}><Download size={18}/> {downloading ? "Menyiapkan Excel…" : "Unduh Excel"}</button>}/><Notice message={error || downloadError}/>{loading ? <Loading/> : data && <><div className="stat-grid report-stats"><div className="stat-card"><span>Produk aktif</span><strong>{data.products}</strong><small>Item tersedia di katalog</small></div><div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Di bawah atau sama batas minimum</small></div><div className="stat-card"><span>Pesanan aktif / selesai</span><strong>{data.confirmed}</strong><small>Dari {data.orders} pesanan</small></div><div className="stat-card highlight"><span>Nilai pesanan</span><strong className="money-stat">{money(data.revenue)}</strong><small>Total pesanan aktif dan selesai</small></div></div><div className="panel report-note"><BarChart3 size={26}/><div><h2>Data siap dibawa lebih jauh</h2><p>File Excel berisi status berwarna, angka Rupiah, tanggal yang bisa diurutkan, serta filter setiap kolom. Nilai pesanan hanya menghitung pesanan yang dikonfirmasi atau selesai.</p></div></div></>}</>
}

function UsersPage() {
  const [refresh, setRefresh] = useState(0), [show, setShow] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<User[]>('/users', refresh)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' })
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api('/users', { method: 'POST', body: JSON.stringify(form) }); setShow(false); setForm({ name: '', email: '', password: '', role: 'STAFF' }); setRefresh(x => x + 1); setSuccess('Pengguna ditambahkan.') } catch (e) { setError((e as Error).message) } }
  async function toggle(user: User) { if (!window.confirm(`${user.active ? 'Nonaktifkan' : 'Aktifkan'} akun ${user.name}?`)) return; setError(''); try { await api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) }); setRefresh(x => x + 1); setSuccess('Status pengguna diperbarui.') } catch (e) { setError((e as Error).message) } }
  return <><SectionHeader eyebrow="TIM TOKO" title="Pengguna" description="Atur siapa yang dapat mengakses ruang kerja toko." action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Tambah pengguna</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>Tambah pengguna</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form className="form-grid" onSubmit={save}><label>Nama<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/></label><label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required/></label><label>Kata sandi awal<input type="password" minLength={12} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required/></label><label>Peran<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="STAFF">Staf</option><option value="MANAGER">Manajer</option></select></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Tambah pengguna</button></div></form></div>}<div className="panel">{loading ? <Loading/> : !data?.length ? <Empty title="Belum ada pengguna"/> : <div className="table-wrap"><table className="responsive-table users-table"><thead><tr><th>PENGGUNA</th><th>PERAN</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{data.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{roleText[user.role]}</td><td><span className={`badge ${user.active ? 'ok' : 'neutral'}`}>{user.active ? 'Aktif' : 'Nonaktif'}</span></td><td>{user.role !== 'OWNER' && <button className="text-button" onClick={() => toggle(user)}>{user.active ? 'Nonaktifkan' : 'Aktifkan'}</button>}</td></tr>)}</tbody></table></div>}</div></>
}

function App() {
  const [account, setAccount] = useState<{ user: User; store: { name: string } } | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => { api<{ user: User; store: { name: string } }>('/auth/me').then(setAccount).catch(() => setAccount(null)).finally(() => setLoading(false)) }, [])
  useEffect(() => { refresh() }, [refresh])
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setAccount(null) }
  if (loading) return <div className="boot"><div className="brand"><span className="brand-mark"><Package size={22}/></span>stokita<span className="brand-dot">.</span></div><Loading/></div>
  return account ? <Shell user={account.user} store={account.store} onLogout={logout}/> : <Login onLogin={(user, store) => setAccount({ user, store })}/>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
