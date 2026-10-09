import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, ClipboardList, ArrowDownUp, Users, BarChart3, LogOut, Plus, Search, Menu, X, Download, ChevronLeft, ChevronRight, ShieldCheck, Store, AlertCircle, CheckCircle2, Truck, RotateCcw } from 'lucide-react'
import './style.css'
import './dashboard.css'
import './demo.css'

type Role = 'OWNER' | 'MANAGER' | 'STAFF'
type User = { id: string; name: string; email: string; role: Role; active?: boolean; branchId?: string | null; branchName?: string | null }
type StoreInfo = { id?: string; name: string; isDemo?: boolean; demoExpiresAt?: string | null }
type Branch = { id: string; code: string; name: string; address: string | null; active: boolean }
type ActiveBranch = { id: string; name: string; code?: string }
type Product = { id: string; sku: string; name: string; category: string | null; price: number; stock: number; minStock: number; active: boolean }
type OrderItem = { id: string; productId: string; quantity: number; unitPrice: number; product: { name: string; sku: string } }
type PaymentStatus = 'UNPAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
type PaymentMethod = 'CASH' | 'TRANSFER' | 'QRIS' | 'CARD'
type SalesReturn = { id: string; number: string; total: number; reason: string; createdAt: string; items: { productId: string; quantity: number; unitPrice: number }[] }
type Order = { id: string; number: string; customerName: string; status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'; paymentStatus: PaymentStatus; paymentMethod: PaymentMethod | null; paidAt: string | null; refundedTotal: number; total: number; createdAt: string; items: OrderItem[]; returns: SalesReturn[] }
type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'
type Transfer = { id: string; number: string; status: TransferStatus; note: string | null; createdAt: string; fromBranch: Pick<Branch, 'id' | 'name' | 'code'>; toBranch: Pick<Branch, 'id' | 'name' | 'code'>; createdBy: { name: string }; receivedBy: { name: string } | null; items: { id: string; productId: string; quantity: number; product: { name: string; sku: string } }[] }
type Movement = { id: string; type: string; quantity: number; balanceAfter: number; reason: string; createdAt: string; product: { name: string; sku: string }; user: { name: string } }
type Summary = { products: number; lowStock: number; orders: number; confirmed: number; paid: number; unpaid: number; revenue: number; recent: { id: string; action: string; entity: string; createdAt: string; user: { name: string } }[] }
type RecentActivity = Summary['recent'][number] & { branch?: { name: string } | null }
type LowStockProduct = Pick<Product, 'id' | 'name' | 'sku' | 'stock' | 'minStock'>
type OwnerDashboard = { role: 'OWNER'; products: number; lowStock: number; orders: number; confirmed: number; revenue: number; activeUsers: number; branchCount: number; branches: { id: string; name: string; code: string; active: boolean; revenue: number; lowStock: number }[]; recent: RecentActivity[] }
type ManagerDashboard = { role: 'MANAGER'; lowStock: number; lowStockProducts: LowStockProduct[]; draftOrders: number; confirmedOrders: number; recent: RecentActivity[] }
type StaffDashboard = { role: 'STAFF'; lowStock: number; lowStockProducts: LowStockProduct[]; draftOrders: number; confirmedOrders: number; queue: Pick<Order, 'id' | 'number' | 'customerName' | 'status' | 'paymentStatus' | 'createdAt'>[] }
type DashboardData = OwnerDashboard | ManagerDashboard | StaffDashboard
type PageData<T> = { items: T[]; total: number; page: number; limit: number }

const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const roleText: Record<Role, string> = { OWNER: 'Pemilik', MANAGER: 'Manajer', STAFF: 'Staf' }
const statusText: Record<Order['status'], string> = { DRAFT: 'Draft', CONFIRMED: 'Dikonfirmasi', FULFILLED: 'Selesai', CANCELLED: 'Dibatalkan' }
const paymentText: Record<PaymentStatus, string> = { UNPAID: 'Belum dibayar', PAID: 'Sudah dibayar', PARTIALLY_REFUNDED: 'Retur sebagian', REFUNDED: 'Direfund' }
const methodText: Record<PaymentMethod, string> = { CASH: 'Tunai', TRANSFER: 'Transfer', QRIS: 'QRIS', CARD: 'Kartu' }

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers }, ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.details?.length ? `${body.error} ${body.details.map((x: { field: string; message: string }) => `${x.field}: ${x.message}`).join('. ')}` : body.error || 'Permintaan gagal.')
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

function Login({ onLogin }: { onLogin: (user: User, store: StoreInfo, branch: ActiveBranch) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState<Role | null>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ user: User; store: StoreInfo; activeBranch: ActiveBranch }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      onLogin(result.user, result.store, result.activeBranch)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function openDemo(role: Role) {
    setDemoBusy(role)
    setError('')
    try {
      const result = await api<{ user: User; store: StoreInfo; activeBranch: ActiveBranch }>('/auth/demo', { method: 'POST', body: JSON.stringify({ role }) })
      onLogin(result.user, result.store, result.activeBranch)
    } catch (e) { setError((e as Error).message) }
    finally { setDemoBusy(null) }
  }
  const roles: { role: Role; description: string }[] = [
    { role: 'OWNER', description: 'Jaringan, katalog, dan tim' },
    { role: 'MANAGER', description: 'Laporan, transfer, dan retur' },
    { role: 'STAFF', description: 'Penjualan dan stok masuk' }
  ]
  return <div className="login-shell">
    <div className="login-story"><div className="brand large"><span className="brand-mark"><Package size={25}/></span><span>stokita<span className="brand-dot">.</span></span></div><div className="story-content"><span className="story-tag">OPERASI TOKO, LEBIH TERARAH</span><h1>Stok akurat.<br/>Pesanan lancar.<br/><em>Keputusan lebih pasti.</em></h1><p>Satu tempat untuk memantau katalog, stok, dan pesanan di seluruh cabang Anda.</p><div className="story-stat"><strong>01</strong><span>Alur kerja yang jelas, dari barang masuk hingga pesanan selesai.</span></div></div><div className="story-footer">STOKITA / INVENTORY OPERATIONS</div></div>
    <div className="login-side"><form className="login-card" onSubmit={submit}>
      <div className="mobile-brand brand"><span className="brand-mark"><Package size={20}/></span>stokita<span className="brand-dot">.</span></div>
      <div className="login-icon"><ShieldCheck size={25}/></div>
      <p className="eyebrow">SELAMAT DATANG</p><h2>Coba Stokita sekarang</h2><p className="muted">Pilih peran untuk langsung melihat cara kerjanya.</p>
      <Notice message={error}/>
      <div className="demo-entry"><p className="demo-caption">Setiap klik membuat ruang demo pribadi dengan data contoh. Bebas mencoba selama 24 jam.</p><div className="demo-role-grid">{roles.map(item => <button type="button" className="demo-role" key={item.role} disabled={busy || demoBusy !== null} onClick={() => openDemo(item.role)}><strong>{demoBusy === item.role ? 'Membuka…' : roleText[item.role]}</strong><small>{item.description}</small></button>)}</div></div>
      <div className="login-divider"><span>atau masuk dengan akun sendiri</span></div>
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/></label>
      <label>Kata sandi<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Masukkan kata sandi"/></label>
      <button className="button primary full" disabled={busy || demoBusy !== null}>{busy ? 'Memproses…' : 'Masuk'}</button>
    </form></div>
  </div>
}

const nav = [{ to: '/', label: 'Ringkasan', icon: LayoutDashboard }, { to: '/branches', label: 'Cabang', icon: Store }, { to: '/products', label: 'Produk', icon: Package }, { to: '/stock', label: 'Pergerakan stok', icon: ArrowDownUp }, { to: '/transfers', label: 'Transfer stok', icon: Truck }, { to: '/orders', label: 'Pesanan', icon: ClipboardList }, { to: '/reports', label: 'Laporan', icon: BarChart3 }, { to: '/users', label: 'Pengguna', icon: Users }]
function Shell({ user, store, activeBranch, onSwitch, onLogout }: { user: User; store: StoreInfo; activeBranch: ActiveBranch; onSwitch: (branchId: string) => Promise<void>; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const { data: branches } = useData<Branch[]>('/branches')
  async function switchBranch(branchId: string) {
    setSwitchError('')
    try { await onSwitch(branchId) } catch (error) { setSwitchError((error as Error).message) }
  }
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><Package size={21}/></span>stokita<span className="brand-dot">.</span></div><button className="mobile-close icon-button" onClick={() => setOpen(false)} aria-label="Tutup menu"><X size={20}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Store size={20}/></div><div><small>{store.isDemo ? 'RUANG DEMO PRIBADI' : 'JARINGAN TOKO'}</small><strong>{store.name}</strong></div></div>
      <div className="branch-picker"><label htmlFor="active-branch">Cabang aktif</label>{user.role === 'OWNER' ? <select id="active-branch" value={activeBranch.id} onChange={event => switchBranch(event.target.value)}>{branches?.filter(branch => branch.active).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : <strong>{activeBranch.name}</strong>}{switchError && <small role="alert">{switchError}</small>}</div>
      <div className="nav-label">MENU UTAMA</div><nav>{nav.filter(item => ((item.to !== '/users' && item.to !== '/branches') || user.role === 'OWNER') && (!['/reports', '/transfers'].includes(item.to) || user.role !== 'STAFF')).map(item => <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={19}/>{item.label}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><small>{roleText[user.role]}</small></div></div><button className="nav-item logout" onClick={onLogout}><LogOut size={18}/>Keluar</button></div>
    </aside>
    <div className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu size={22}/></button><div className="breadcrumb">{store.name} <span>/</span> {activeBranch.name}</div><div className="topbar-right"><span className="live-dot"/>Sistem aktif <span className="topbar-sep"/> {user.name}</div></header><main className="content" key={activeBranch.id}><Routes><Route path="/" element={<Dashboard role={user.role}/>}/><Route path="/branches" element={user.role === 'OWNER' ? <BranchesPage activeBranch={activeBranch}/> : <Navigate to="/"/>}/><Route path="/products" element={<Products role={user.role}/>}/><Route path="/stock" element={<Stock role={user.role}/>}/><Route path="/transfers" element={user.role !== 'STAFF' ? <Transfers activeBranch={activeBranch}/> : <Navigate to="/"/>}/><Route path="/orders" element={<Orders role={user.role}/>}/><Route path="/reports" element={user.role !== 'STAFF' ? <Reports role={user.role}/> : <Navigate to="/"/>}/><Route path="/users" element={user.role === 'OWNER' ? <UsersPage/> : <Navigate to="/"/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes></main></div>{open && <div className="scrim" onClick={() => setOpen(false)}/>}</div>
}

function ActivityPanel({ items }: { items: RecentActivity[] }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">JEJAK AKTIVITAS</p><h2>Aktivitas terbaru</h2></div></div>{items.length ? <div className="activity-list">{items.map(item => <div className="activity" key={item.id}><span className="activity-icon"><ArrowDownUp size={17}/></span><div><strong>{item.user.name} • {item.action.toLowerCase()} {item.entity.toLowerCase()}</strong><small>{item.branch?.name ? `${item.branch.name} · ` : ''}{date(item.createdAt)}</small></div></div>)}</div> : <Empty title="Belum ada aktivitas" detail="Aktivitas toko akan tampil di sini."/>}</section>
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
    <SectionHeader eyebrow="PUSAT JARINGAN" title="Kondisi seluruh cabang" description="Pantau pesanan dan tim dari semua cabang dalam satu tempat."/>
    <div className="dashboard-actions"><button className="button primary" onClick={() => navigate('/reports')}><BarChart3 size={18}/> Lihat laporan</button><button className="button subtle" onClick={() => navigate('/users')}><Users size={18}/> Kelola pengguna</button></div>
    <div className="dashboard-stats">
      <div className="stat-card"><span>Cabang aktif</span><strong>{data.branchCount}</strong><small>Lokasi dalam jaringan</small><Store size={23}/></div>
      <div className="stat-card"><span>Produk aktif</span><strong>{data.products}</strong><small>Dalam katalog</small><Package size={23}/></div>
      <div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Di seluruh cabang</small><AlertCircle size={23}/></div>
      <div className="stat-card"><span>Total pesanan</span><strong>{data.orders}</strong><small>{data.confirmed} dikonfirmasi / selesai</small><ClipboardList size={23}/></div>
      <div className="stat-card highlight"><span>Pendapatan bersih</span><strong className="money-stat">{money(data.revenue)}</strong><small>Pembayaran setelah retur</small><BarChart3 size={23}/></div>
      <div className="stat-card"><span>Pengguna aktif</span><strong>{data.activeUsers}</strong><small>Tim toko yang dapat masuk</small><Users size={23}/></div>
    </div>
    <section className="panel network-panel"><div className="panel-heading"><div><p className="eyebrow">PER CABANG</p><h2>Kinerja jaringan</h2></div><button className="text-button" onClick={() => navigate('/branches')}>Kelola cabang</button></div><div className="table-wrap"><table className="responsive-table"><thead><tr><th>CABANG</th><th>STATUS</th><th>PENDAPATAN BERSIH</th><th>STOK RENDAH</th></tr></thead><tbody>{data.branches.map(branch => <tr key={branch.id}><td><strong>{branch.name}</strong><small>{branch.code}</small></td><td><span className={`badge ${branch.active ? 'ok' : 'neutral'}`}>{branch.active ? 'Aktif' : 'Nonaktif'}</span></td><td>{money(branch.revenue)}</td><td>{branch.lowStock}</td></tr>)}</tbody></table></div></section>
    <div className="dashboard-panels"><ActivityPanel items={data.recent}/><section className="quick-panel"><p className="eyebrow">LANGKAH BERIKUTNYA</p><h2>Ambil keputusan dari data toko.</h2><p>Periksa pesanan dan stok sebelum merencanakan langkah berikutnya.</p><button onClick={() => navigate('/orders')}>Lihat pesanan <ChevronRight size={18}/></button><button onClick={() => navigate('/products')}>Lihat produk <ChevronRight size={18}/></button></section></div>
  </>

  if (data.role === 'MANAGER') return <>
    <SectionHeader eyebrow="UNTUK MANAJER" title="Operasional toko" description="Prioritaskan stok dan pesanan yang perlu ditangani."/>
    <div className="dashboard-actions"><button className="button primary" onClick={() => navigate('/orders')}><ClipboardList size={18}/> Kelola pesanan</button><button className="button subtle" onClick={() => navigate('/transfers')}><Truck size={18}/> Transfer stok</button><button className="button subtle" onClick={() => navigate('/reports')}><BarChart3 size={18}/> Lihat laporan</button></div>
    <div className="dashboard-stats">
      <div className="stat-card warning"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Produk perlu perhatian</small><AlertCircle size={23}/></div>
      <div className="stat-card"><span>Pesanan draft</span><strong>{data.draftOrders}</strong><small>Menunggu konfirmasi</small><ClipboardList size={23}/></div>
      <div className="stat-card"><span>Pesanan dikonfirmasi</span><strong>{data.confirmedOrders}</strong><small>Menunggu pembayaran atau penyelesaian</small><CheckCircle2 size={23}/></div>
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
    <div className="dashboard-panels"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ANTREAN TOKO</p><h2>Pesanan yang perlu ditangani</h2></div><button className="text-button" onClick={() => navigate('/orders')}>Lihat semua</button></div>{data.queue.length ? <div className="dashboard-list">{data.queue.map(order => <div className="dashboard-row" key={order.id}><div><strong>{order.number}</strong><small>{order.customerName} • {date(order.createdAt)}</small></div><span className={`badge payment-${order.paymentStatus.toLowerCase()}`}>{order.status === 'DRAFT' ? 'Perlu konfirmasi' : paymentText[order.paymentStatus]}</span></div>)}</div> : <Empty title="Antrean kosong" detail="Belum ada pesanan yang perlu ditangani."/>}</section><LowStockPanel items={data.lowStockProducts} onOpen={() => navigate('/products')}/></div>
  </>
}

function Products({ role }: { role: Role }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0), [show, setShow] = useState(false), [editing, setEditing] = useState<Product | null>(null), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Product>>(`/products?page=${page}&limit=10&search=${encodeURIComponent(query)}`, refresh)
  const [form, setForm] = useState({ sku: '', name: '', category: '', price: 0 as number | '', minStock: 5 as number | '', active: true })
  function openForm(product?: Product) { setEditing(product || null); setForm(product ? { sku: product.sku, name: product.name, category: product.category || '', price: product.price, minStock: product.minStock, active: product.active } : { sku: '', name: '', category: '', price: 0, minStock: 5, active: true }); setShow(true); setError(''); setSuccess('') }
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api(`/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, price: Number(form.price), minStock: Number(form.minStock) }) }); setShow(false); setRefresh(x => x + 1); setSuccess(editing ? 'Produk diperbarui.' : 'Produk ditambahkan.') } catch (e) { setError((e as Error).message) } }
  return <><SectionHeader eyebrow="KATALOG" title="Produk" description="Katalog dan harga berlaku di seluruh cabang. Stok mengikuti cabang aktif." action={role === 'OWNER' && <button className="button primary" onClick={() => openForm()}><Plus size={18}/> Tambah produk</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>{editing ? 'Ubah produk' : 'Tambah produk baru'}</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save} className="form-grid"><label>SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required maxLength={40}/></label><label>Nama produk<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/></label><label>Kategori<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label><label>Harga (Rp)<input type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value === '' ? '' : Number(e.target.value) })} required/></label><label>Batas stok minimum<input type="number" min="0" value={form.minStock} onChange={e => setForm({ ...form, minStock: e.target.value === '' ? '' : Number(e.target.value) })} required/></label><label>Status<select value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan produk</button></div></form></div>}<div className="panel"><div className="table-toolbar"><form className="search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search) }}><Search size={18}/><input placeholder="Cari nama atau SKU…" value={search} onChange={e => setSearch(e.target.value)}/><button type="submit">Cari</button></form><span className="table-count">{data?.total || 0} produk</span></div>{loading ? <Loading/> : !data?.items.length ? <Empty title="Produk belum ditemukan" detail="Tambahkan produk pertama atau ubah pencarian Anda."/> : <><div className="table-wrap"><table className="responsive-table product-table"><thead><tr><th>PRODUK</th><th>KATEGORI</th><th>HARGA</th><th>STOK</th><th>STATUS</th>{role === 'OWNER' && <th>AKSI</th>}</tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td>{item.category || '-'}</td><td>{money(item.price)}</td><td><span className={`stock-value ${item.stock <= item.minStock ? 'low' : ''}`}>{item.stock}</span></td><td><span className={`badge ${item.active ? 'ok' : 'neutral'}`}>{item.active ? 'Aktif' : 'Nonaktif'}</span></td>{role === 'OWNER' && <td><button className="text-button" onClick={() => openForm(item)}>Ubah</button></td>}</tr>)}</tbody></table></div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div></>
}

function Stock({ role }: { role: Role }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [show, setShow] = useState(() => new URLSearchParams(window.location.search).has('new')), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Movement>>(`/stock-movements?page=${page}&limit=10`, refresh)
  const products = useData<PageData<Product>>('/products?limit=100', refresh)
  const [form, setForm] = useState({ productId: '', type: 'IN', quantity: 1 as number | '', reason: '' })
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api('/stock-movements', { method: 'POST', body: JSON.stringify({ ...form, quantity: Number(form.quantity) }) }); setShow(false); setForm({ productId: '', type: 'IN', quantity: 1, reason: '' }); setRefresh(x => x + 1); setSuccess('Pergerakan stok dicatat.') } catch (e) { setError((e as Error).message) } }
  return <><SectionHeader eyebrow="INVENTARIS" title="Pergerakan stok" description={role === 'STAFF' ? 'Catat barang masuk. Koreksi saldo membutuhkan persetujuan manajer.' : 'Catat barang masuk dan koreksi saldo dengan riwayat yang dapat ditelusuri.'} action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Catat stok</button>}/><Notice message={loadError || error}/><Notice message={success} tone="success"/>{show && <div className="form-panel"><div className="panel-heading"><h2>Catat pergerakan</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save} className="form-grid"><label>Produk<select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required><option value="">Pilih produk</option>{products.data?.items.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name} - stok {x.stock}</option>)}</select></label><label>Jenis<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, quantity: e.target.value === 'IN' ? 1 : 0 })}><option value="IN">Stok masuk</option>{role !== 'STAFF' && <option value="ADJUSTMENT">Koreksi stok (+ / −)</option>}</select></label><label>Perubahan jumlah<input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value === '' ? '' : Number(e.target.value) })} required/></label><label>Alasan<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required placeholder="Contoh: kiriman pemasok"/></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan catatan</button></div></form></div>}<div className="panel">{loading ? <Loading/> : !data?.items.length ? <Empty title="Belum ada pergerakan stok" detail="Catat barang masuk untuk mulai mengisi stok."/> : <><div className="table-wrap"><table className="responsive-table stock-table"><thead><tr><th>TANGGAL</th><th>PRODUK</th><th>JENIS</th><th>PERUBAHAN</th><th>SALDO</th><th>ALASAN / OLEH</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{date(item.createdAt)}</td><td><strong>{item.product.name}</strong><small>{item.product.sku}</small></td><td><span className="badge neutral">{({ IN: 'Masuk', ADJUSTMENT: 'Koreksi', SALE: 'Penjualan', RETURN: 'Pengembalian', TRANSFER_OUT: 'Transfer keluar', TRANSFER_IN: 'Transfer masuk' } as Record<string, string>)[item.type]}</span></td><td><strong className={item.quantity < 0 ? 'negative' : 'positive'}>{item.quantity > 0 ? '+' : ''}{item.quantity}</strong></td><td>{item.balanceAfter}</td><td>{item.reason}<small>{item.user.name}</small></td></tr>)}</tbody></table></div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div></>
}

function Transfers({ activeBranch }: { activeBranch: ActiveBranch }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [show, setShow] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState('')
  const { data, loading, error: loadError } = useData<PageData<Transfer>>(`/transfers?page=${page}&limit=10`, refresh)
  const destinations = useData<Pick<Branch, 'id' | 'name' | 'code'>[]>('/transfer-options', refresh)
  const products = useData<PageData<Product>>('/products?limit=100', refresh)
  const [toBranchId, setToBranchId] = useState(''), [note, setNote] = useState(''), [lines, setLines] = useState([{ productId: '', quantity: 1 as number | '' }])
  const transferStatus: Record<TransferStatus, string> = { DRAFT: 'Draft', IN_TRANSIT: 'Dalam perjalanan', RECEIVED: 'Diterima', CANCELLED: 'Dibatalkan' }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccess('')
    try {
      await api('/transfers', { method: 'POST', body: JSON.stringify({ toBranchId, note, items: lines.map(line => ({ ...line, quantity: Number(line.quantity) })) }) })
      setShow(false); setToBranchId(''); setNote(''); setLines([{ productId: '', quantity: 1 }]); setRefresh(value => value + 1); setSuccess('Draft transfer berhasil dibuat.')
    } catch (cause) { setError((cause as Error).message) }
  }
  async function action(transfer: Transfer, kind: 'send' | 'receive' | 'cancel') {
    const label = { send: 'mengirim', receive: 'menerima', cancel: 'membatalkan' }[kind]
    if (!window.confirm(`Yakin ingin ${label} transfer ${transfer.number}?`)) return
    setBusy(transfer.id); setError(''); setSuccess('')
    try { await api(`/transfers/${transfer.id}/${kind}`, { method: 'POST' }); setRefresh(value => value + 1); setSuccess('Status transfer berhasil diperbarui.') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy('') }
  }
  return <>
    <SectionHeader eyebrow="LOGISTIK CABANG" title="Transfer stok" description={`Kirim barang dari ${activeBranch.name} dan konfirmasi saat barang tiba di cabang tujuan.`} action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Transfer baru</button>}/>
    <Notice message={loadError || destinations.error || products.error || error}/><Notice message={success} tone="success"/>
    {show && <div className="form-panel"><div className="panel-heading"><div><h2>Buat transfer dari {activeBranch.name}</h2><p className="muted">Stok baru berkurang setelah transfer dikirim.</p></div><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save}><div className="form-grid"><label>Cabang tujuan<select value={toBranchId} onChange={event => setToBranchId(event.target.value)} required><option value="">Pilih cabang</option>{destinations.data?.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Catatan<input value={note} onChange={event => setNote(event.target.value)} placeholder="Contoh: pengisian stok akhir pekan"/></label></div><div className="line-heading">BARANG YANG DIKIRIM</div>{lines.map((line, index) => <div className="order-line" key={index}><label>Produk<select value={line.productId} onChange={event => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item))} required><option value="">Pilih produk</option>{products.data?.items.filter(product => product.active).map(product => <option key={product.id} value={product.id}>{product.name} - stok {product.stock}</option>)}</select></label><label>Jumlah<input type="number" min="1" value={line.quantity} onChange={event => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value === '' ? '' : Number(event.target.value) } : item))} required/></label><button type="button" className="icon-button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, itemIndex) => itemIndex !== index))} aria-label="Hapus barang"><X size={18}/></button></div>)}<button type="button" className="text-button add-line" onClick={() => setLines([...lines, { productId: '', quantity: 1 }])}>+ Tambah barang</button><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan draft</button></div></form></div>}
    <div className="panel">{loading ? <Loading/> : !data?.items.length ? <Empty title="Belum ada transfer stok" detail="Buat transfer pertama untuk memindahkan barang antar cabang."/> : <><div className="transfer-list">{data.items.map(transfer => <article className="transfer-card" key={transfer.id}><div className="transfer-route"><div><span>DARI</span><strong>{transfer.fromBranch.name}</strong></div><Truck size={22}/><div><span>TUJUAN</span><strong>{transfer.toBranch.name}</strong></div></div><div className="transfer-summary"><div><strong>{transfer.number}</strong><small>{date(transfer.createdAt)} · {transfer.createdBy.name}</small></div><span className={`badge transfer-${transfer.status.toLowerCase()}`}>{transferStatus[transfer.status]}</span></div><div className="transfer-items">{transfer.items.map(item => <span key={item.id}>{item.product.name} × {item.quantity}</span>)}</div>{transfer.note && <p className="transfer-note">{transfer.note}</p>}<div className="order-actions">{transfer.status === 'DRAFT' && transfer.fromBranch.id === activeBranch.id && <><button className="button small primary" disabled={busy === transfer.id} onClick={() => action(transfer, 'send')}>Kirim barang</button><button className="button small subtle" disabled={busy === transfer.id} onClick={() => action(transfer, 'cancel')}>Batalkan</button></>}{transfer.status === 'IN_TRANSIT' && transfer.toBranch.id === activeBranch.id && <button className="button small primary" disabled={busy === transfer.id} onClick={() => action(transfer, 'receive')}>Konfirmasi diterima</button>}</div></article>)}</div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div>
  </>
}

function Orders({ role }: { role: Role }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState(''), [refresh, setRefresh] = useState(0), [show, setShow] = useState(() => new URLSearchParams(window.location.search).has('new')), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState('')
  const [paying, setPaying] = useState<Order | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('QRIS')
  const [returning, setReturning] = useState<Order | null>(null)
  const [returnReason, setReturnReason] = useState(''), [returnLines, setReturnLines] = useState<{ productId: string; name: string; max: number; quantity: number | '' }[]>([])
  const { data, loading, error: loadError } = useData<PageData<Order>>(`/orders?page=${page}&limit=10&search=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`, refresh)
  const products = useData<PageData<Product>>('/products?limit=100')
  const [customerName, setCustomerName] = useState(''), [lines, setLines] = useState([{ productId: '', quantity: 1 as number | '' }])
  async function save(e: React.FormEvent) { e.preventDefault(); setError(''); try { await api('/orders', { method: 'POST', body: JSON.stringify({ customerName, items: lines.map(l => ({ ...l, quantity: Number(l.quantity) })) }) }); setShow(false); setCustomerName(''); setLines([{ productId: '', quantity: 1 }]); setRefresh(x => x + 1); setSuccess('Draft pesanan dibuat.') } catch (e) { setError((e as Error).message) } }
  async function action(order: Order, kind: 'confirm' | 'cancel' | 'fulfill' | 'refund') {
    const label = { confirm: 'mengonfirmasi', cancel: 'membatalkan', fulfill: 'menyelesaikan', refund: 'merefund' }[kind]
    if (!window.confirm(`Yakin ingin ${label} pesanan ${order.number}?`)) return
    setBusy(order.id); setError(''); setSuccess('')
    try { await api(`/orders/${order.id}/${kind}`, { method: 'POST' }); setRefresh(x => x + 1); setSuccess(`Pesanan berhasil diproses.`) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy('') }
  }
  async function pay(e: React.FormEvent) {
    e.preventDefault()
    if (!paying) return
    setBusy(paying.id); setError(''); setSuccess('')
    try { await api(`/orders/${paying.id}/pay`, { method: 'POST', body: JSON.stringify({ method: paymentMethod }) }); setPaying(null); setRefresh(x => x + 1); setSuccess('Pembayaran berhasil dicatat.') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy('') }
  }
  function openReturn(order: Order) {
    const alreadyReturned = new Map<string, number>()
    for (const previous of order.returns) for (const item of previous.items) alreadyReturned.set(item.productId, (alreadyReturned.get(item.productId) || 0) + item.quantity)
    setReturnLines(order.items.map(item => ({ productId: item.productId, name: item.product.name, max: item.quantity - (alreadyReturned.get(item.productId) || 0), quantity: 0 })).filter(item => item.max > 0))
    setReturnReason(''); setReturning(order); setError(''); setSuccess('')
  }
  async function submitReturn(e: React.FormEvent) {
    e.preventDefault()
    if (!returning) return
    const items = returnLines.filter(item => Number(item.quantity) > 0).map(item => ({ productId: item.productId, quantity: Number(item.quantity) }))
    if (!items.length) { setError('Pilih sedikitnya satu barang untuk diretur.'); return }
    setBusy(returning.id); setError(''); setSuccess('')
    try { await api(`/orders/${returning.id}/returns`, { method: 'POST', body: JSON.stringify({ reason: returnReason, items }) }); setReturning(null); setRefresh(value => value + 1); setSuccess('Retur berhasil dicatat dan stok sudah dikembalikan.') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy('') }
  }
  return <>
    <SectionHeader eyebrow="PENJUALAN" title="Pesanan" description="Buat pesanan, kurangi stok, catat pembayaran, lalu selesaikan transaksi." action={<button className="button primary" onClick={() => { setShow(true); setError(''); setSuccess('') }}><Plus size={18}/> Pesanan baru</button>}/>
    <Notice message={loadError || error}/><Notice message={success} tone="success"/>
    {show && <div className="form-panel"><div className="panel-heading"><h2>Buat draft pesanan</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={save}><div className="form-grid"><label>Nama pelanggan<input value={customerName} onChange={e => setCustomerName(e.target.value)} required/></label></div><div className="line-heading">ITEM PESANAN</div>{lines.map((line, index) => <div className="order-line" key={index}><label>Produk<select value={line.productId} onChange={e => setLines(lines.map((x, i) => i === index ? { ...x, productId: e.target.value } : x))} required><option value="">Pilih produk</option>{products.data?.items.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name} - {money(x.price)} (stok {x.stock})</option>)}</select></label><label>Jumlah<input type="number" min="1" value={line.quantity} onChange={e => setLines(lines.map((x, i) => i === index ? { ...x, quantity: e.target.value === '' ? '' : Number(e.target.value) } : x))} required/></label><button type="button" className="icon-button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))} aria-label="Hapus item"><X size={18}/></button></div>)}<button type="button" className="text-button add-line" onClick={() => setLines([...lines, { productId: '', quantity: 1 }])}>+ Tambah item</button><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Simpan draft</button></div></form></div>}
    {paying && <div className="form-panel payment-panel"><div className="panel-heading"><div><h2>Catat pembayaran</h2><p>{paying.number} · {money(paying.total)}</p></div><button className="icon-button" onClick={() => setPaying(null)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={pay} className="form-grid"><label>Metode pembayaran<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}><option value="QRIS">QRIS</option><option value="CASH">Tunai</option><option value="TRANSFER">Transfer</option><option value="CARD">Kartu</option></select></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setPaying(null)}>Batal</button><button className="button primary" disabled={busy === paying.id}>Simpan pembayaran</button></div></form></div>}
    {returning && <div className="form-panel return-panel"><div className="panel-heading"><div><h2>Retur barang</h2><p className="muted">{returning.number} · pilih jumlah yang benar benar dikembalikan</p></div><button className="icon-button" onClick={() => setReturning(null)} aria-label="Tutup"><X size={18}/></button></div><form onSubmit={submitReturn}><div className="return-lines">{returnLines.map((line, index) => <label key={line.productId}><span>{line.name}<small>Maksimal {line.max}</small></span><input type="number" min="0" max={line.max} value={line.quantity} onChange={event => setReturnLines(returnLines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value === '' ? '' : Number(event.target.value) } : item))}/></label>)}</div><div className="form-grid"><label>Alasan retur<input value={returnReason} onChange={event => setReturnReason(event.target.value)} required minLength={3} placeholder="Contoh: kemasan rusak"/></label></div><div className="form-actions"><button type="button" className="button subtle" onClick={() => setReturning(null)}>Batal</button><button className="button primary" disabled={busy === returning.id}><RotateCcw size={17}/> Proses retur</button></div></form></div>}
    <div className="panel"><div className="table-toolbar"><form className="search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search) }}><Search size={18}/><input placeholder="Cari nomor atau pelanggan…" value={search} onChange={e => setSearch(e.target.value)}/><button type="submit">Cari</button></form><select className="filter-select" value={status} onChange={e => { setPage(1); setStatus(e.target.value) }}><option value="">Semua status</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Dikonfirmasi</option><option value="FULFILLED">Selesai</option><option value="CANCELLED">Dibatalkan</option></select></div>{loading ? <Loading/> : !data?.items.length ? <Empty title="Pesanan belum ditemukan" detail="Buat pesanan pertama atau ubah filter Anda."/> : <><div className="order-list">{data.items.map(order => <article className="order-card" key={order.id}><div className="order-main"><div><strong>{order.number}</strong><p>{order.customerName} <span>•</span> {date(order.createdAt)}</p></div><div className="order-badges"><span className={`badge status-${order.status.toLowerCase()}`}>{statusText[order.status]}</span><span className={`badge payment-${order.paymentStatus.toLowerCase()}`}>{paymentText[order.paymentStatus]}{order.paymentMethod ? ` · ${methodText[order.paymentMethod]}` : ''}</span></div></div><div className="order-detail"><div>{order.items.map(item => `${item.product.name} × ${item.quantity}`).join(' · ')}{order.returns.length > 0 && <small className="return-count">{order.returns.length} retur tercatat</small>}</div><strong>{order.refundedTotal > 0 ? <><small>{money(order.total)}</small>{money(order.total - order.refundedTotal)}</> : money(order.total)}</strong></div><div className="order-actions">{order.status === 'DRAFT' && <button className="button small primary" disabled={busy === order.id} onClick={() => action(order, 'confirm')}>Konfirmasi dan reservasi stok</button>}{order.status === 'CONFIRMED' && order.paymentStatus === 'UNPAID' && <><button className="button small primary" disabled={busy === order.id} onClick={() => { setPaying(order); setPaymentMethod('QRIS') }}>Catat pembayaran</button>{role !== 'STAFF' && <button className="button small subtle" disabled={busy === order.id} onClick={() => action(order, 'cancel')}>Batalkan</button>}</>}{order.status === 'CONFIRMED' && order.paymentStatus === 'PAID' && <><button className="button small primary" disabled={busy === order.id} onClick={() => action(order, 'fulfill')}>Tandai selesai</button>{role !== 'STAFF' && <button className="button small danger" disabled={busy === order.id} onClick={() => action(order, 'refund')}>Refund</button>}</>}{role !== 'STAFF' && order.status === 'FULFILLED' && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) && <button className="button small subtle" disabled={busy === order.id} onClick={() => openReturn(order)}><RotateCcw size={15}/> Retur barang</button>}</div></article>)}</div><Pager page={page} total={data.total} limit={data.limit} onChange={setPage}/></>}</div>
  </>
}

function Reports({ role }: { role: Role }) {
  const { data, loading, error } = useData<Summary>('/reports/summary')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function download(network = false) {
    setDownloading(true)
    setDownloadError('')
    try {
      const response = await fetch(network ? '/api/reports/network.xlsx' : '/api/reports/orders.xlsx')
      if (!response.ok) throw new Error('Laporan belum dapat diunduh. Silakan coba lagi.')
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = network ? 'laporan-jaringan.xlsx' : 'laporan-pesanan.xlsx'
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
  return <><SectionHeader eyebrow="ANALISIS" title="Laporan" description="Pantau pendapatan bersih setelah retur dan unduh data cabang aktif." action={<div className="report-actions"><button className="button primary" onClick={() => download()} disabled={downloading}><Download size={18}/> Excel cabang</button>{role === 'OWNER' && <button className="button subtle" onClick={() => download(true)} disabled={downloading}><Download size={18}/> Excel jaringan</button>}</div>}/><Notice message={error || downloadError}/>{loading ? <Loading/> : data && <><div className="stat-grid report-stats"><div className="stat-card"><span>Transaksi dibayar</span><strong>{data.paid}</strong><small>Dari {data.orders} pesanan</small></div><div className="stat-card warning"><span>Menunggu pembayaran</span><strong>{data.unpaid}</strong><small>Sudah dikonfirmasi</small></div><div className="stat-card"><span>Stok menipis</span><strong>{data.lowStock}</strong><small>Perlu ditindaklanjuti</small></div><div className="stat-card highlight"><span>Pendapatan bersih</span><strong className="money-stat">{money(data.revenue)}</strong><small>Setelah pembayaran dan nilai retur</small></div></div><div className="panel report-note"><BarChart3 size={26}/><div><h2>Angka yang dapat dipertanggungjawabkan</h2><p>Pendapatan dihitung dari pembayaran yang diterima setelah dikurangi retur. File Excel memuat status, metode, nilai awal, retur, nilai bersih, dan tanggal.</p></div></div></>}</>
}

function BranchesPage({ activeBranch }: { activeBranch: ActiveBranch }) {
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [form, setForm] = useState({ code: '', name: '', address: '' })
  const { data, loading, error: loadError } = useData<Branch[]>('/branches', refresh)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await api(editing ? `/branches/${editing.id}` : '/branches', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? { name: form.name, address: form.address } : form) })
      setShow(false)
      setEditing(null)
      setForm({ code: '', name: '', address: '' })
      setRefresh(value => value + 1)
      setSuccess(editing ? 'Cabang diperbarui.' : 'Cabang ditambahkan.')
    } catch (cause) { setError((cause as Error).message) }
  }
  async function toggle(branch: Branch) {
    setError('')
    try {
      await api(`/branches/${branch.id}`, { method: 'PATCH', body: JSON.stringify({ active: !branch.active }) })
      setRefresh(value => value + 1)
      setSuccess('Status cabang diperbarui.')
    } catch (cause) { setError((cause as Error).message) }
  }
  return <><SectionHeader eyebrow="JARINGAN" title="Cabang" description="Kelola lokasi yang memakai katalog bersama dan stok masing-masing." action={<button className="button primary" onClick={() => { setEditing(null); setForm({ code: '', name: '', address: '' }); setShow(true) }}><Plus size={18}/> Tambah cabang</button>}/>
    <Notice message={loadError || error}/><Notice message={success} tone="success"/>
    {show && <div className="form-panel"><div className="panel-heading"><h2>{editing ? 'Ubah cabang' : 'Cabang baru'}</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form className="form-grid" onSubmit={save}><label>Kode cabang<input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} maxLength={20} required disabled={!!editing} placeholder="Contoh: BANDUNG"/></label><label>Nama cabang<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required/></label><label>Alamat<input value={form.address} onChange={event => setForm({ ...form, address: event.target.value })}/></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">{editing ? 'Simpan perubahan' : 'Simpan cabang'}</button></div></form></div>}
    <div className="panel">{loading ? <Loading/> : !data?.length ? <Empty title="Belum ada cabang"/> : <div className="table-wrap"><table className="responsive-table"><thead><tr><th>CABANG</th><th>KODE</th><th>ALAMAT</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{data.map(branch => <tr key={branch.id}><td><strong>{branch.name}</strong>{branch.id === activeBranch.id && <small>Cabang aktif</small>}</td><td>{branch.code}</td><td>{branch.address || '-'}</td><td><span className={`badge ${branch.active ? 'ok' : 'neutral'}`}>{branch.active ? 'Aktif' : 'Nonaktif'}</span></td><td><button className="text-button" onClick={() => { setEditing(branch); setForm({ code: branch.code, name: branch.name, address: branch.address || '' }); setShow(true) }}>Ubah</button> <button className="text-button" disabled={branch.id === activeBranch.id && branch.active} onClick={() => toggle(branch)}>{branch.active ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>)}</tbody></table></div>}</div>
  </>
}

function UsersPage() {
  const [refresh, setRefresh] = useState(0)
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { data, loading, error: loadError } = useData<User[]>('/users', refresh)
  const { data: branches } = useData<Branch[]>('/branches')
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF', branchId: '' })
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(form) })
      setShow(false)
      setForm({ name: '', email: '', password: '', role: 'STAFF', branchId: '' })
      setRefresh(value => value + 1)
      setSuccess('Pengguna ditambahkan.')
    } catch (cause) { setError((cause as Error).message) }
  }
  async function update(user: User, body: { active?: boolean; branchId?: string }) {
    setError('')
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setRefresh(value => value + 1)
      setSuccess('Pengguna diperbarui. Sesi lama pengguna yang dipindahkan telah diakhiri.')
    } catch (cause) { setError((cause as Error).message) }
  }
  return <><SectionHeader eyebrow="TIM JARINGAN" title="Pengguna" description="Tentukan cabang kerja setiap manajer dan staf." action={<button className="button primary" onClick={() => setShow(true)}><Plus size={18}/> Tambah pengguna</button>}/>
    <Notice message={loadError || error}/><Notice message={success} tone="success"/>
    {show && <div className="form-panel"><div className="panel-heading"><h2>Tambah pengguna</h2><button className="icon-button" onClick={() => setShow(false)} aria-label="Tutup"><X size={18}/></button></div><form className="form-grid" onSubmit={save}><label>Nama<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required/></label><label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required/></label><label>Kata sandi awal<input type="password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required/></label><label>Peran<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}><option value="STAFF">Staf</option><option value="MANAGER">Manajer</option></select></label><label>Cabang<select value={form.branchId} onChange={event => setForm({ ...form, branchId: event.target.value })} required><option value="">Pilih cabang</option>{branches?.filter(branch => branch.active).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><div className="form-actions"><button type="button" className="button subtle" onClick={() => setShow(false)}>Batal</button><button className="button primary">Tambah pengguna</button></div></form></div>}
    <div className="panel">{loading ? <Loading/> : !data?.length ? <Empty title="Belum ada pengguna"/> : <div className="table-wrap"><table className="responsive-table users-table"><thead><tr><th>PENGGUNA</th><th>PERAN</th><th>CABANG</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{data.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{roleText[user.role]}</td><td>{user.role === 'OWNER' ? 'Seluruh jaringan' : <select aria-label={`Cabang ${user.name}`} value={user.branchId || ''} onChange={event => update(user, { branchId: event.target.value })}>{branches?.filter(branch => branch.active || branch.id === user.branchId).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>}</td><td><span className={`badge ${user.active ? 'ok' : 'neutral'}`}>{user.active ? 'Aktif' : 'Nonaktif'}</span></td><td>{user.role !== 'OWNER' && <button className="text-button" onClick={() => update(user, { active: !user.active })}>{user.active ? 'Nonaktifkan' : 'Aktifkan'}</button>}</td></tr>)}</tbody></table></div>}</div>
  </>
}

function App() {
  const [account, setAccount] = useState<{ user: User; store: StoreInfo; activeBranch: ActiveBranch } | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => { api<{ user: User; store: StoreInfo; activeBranch: ActiveBranch }>('/auth/me').then(setAccount).catch(() => setAccount(null)).finally(() => setLoading(false)) }, [])
  useEffect(() => { refresh() }, [refresh])
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setAccount(null) }
  async function switchBranch(branchId: string) {
    const result = await api<{ activeBranch: ActiveBranch }>('/auth/active-branch', { method: 'PATCH', body: JSON.stringify({ branchId }) })
    setAccount(current => current && { ...current, activeBranch: result.activeBranch })
  }
  if (loading) return <div className="boot"><div className="brand"><span className="brand-mark"><Package size={22}/></span>stokita<span className="brand-dot">.</span></div><Loading/></div>
  return account ? <Shell user={account.user} store={account.store} activeBranch={account.activeBranch} onSwitch={switchBranch} onLogout={logout}/> : <Login onLogin={(user, store, activeBranch) => setAccount({ user, store, activeBranch })}/>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
