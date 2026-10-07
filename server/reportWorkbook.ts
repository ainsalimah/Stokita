import ExcelJS from 'exceljs'

type ReportOrder = {
  number: string
  customerName: string
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  total: number
  createdAt: Date
}

const ink = 'FF17334A'
const blue = 'FF117DA3'
const pale = 'FFF3F8FB'
const border = 'FFE3ECF2'
const white = 'FFFFFFFF'
const statusLabels: Record<ReportOrder['status'], string> = {
  DRAFT: 'Draft', CONFIRMED: 'Dikonfirmasi', FULFILLED: 'Selesai', CANCELLED: 'Dibatalkan'
}
const statusColors: Record<ReportOrder['status'], { background: string; foreground: string }> = {
  DRAFT: { background: 'FFEFF3F6', foreground: 'FF5E7184' },
  CONFIRMED: { background: 'FFE3F7ED', foreground: 'FF147B55' },
  FULFILLED: { background: 'FFE4F1FA', foreground: 'FF216D9A' },
  CANCELLED: { background: 'FFFFEFEC', foreground: 'FFAE4E3E' }
}

export function buildOrderWorkbook(storeName: string, orders: ReportOrder[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Stokita'
  workbook.title = 'Laporan Pesanan'
  const sheet = workbook.addWorksheet('Pesanan', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 23 }
  })
  sheet.columns = [
    { key: 'number', width: 20 },
    { key: 'customer', width: 25 },
    { key: 'status', width: 18 },
    { key: 'total', width: 19 },
    { key: 'date', width: 22 }
  ]

  sheet.mergeCells('A1:E2')
  const title = sheet.getCell('A1')
  title.value = 'LAPORAN PESANAN'
  title.font = { name: 'Aptos Display', size: 19, bold: true, color: { argb: white } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } }
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sheet.getRow(1).height = 24
  sheet.getRow(2).height = 20

  sheet.mergeCells('A3:E3')
  const store = sheet.getCell('A3')
  store.value = `Toko: ${storeName}`
  store.font = { name: 'Aptos', size: 12, bold: true, color: { argb: ink } }
  store.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(3).height = 31

  sheet.mergeCells('A4:C4')
  const count = sheet.getCell('A4')
  count.value = `${orders.length} pesanan tercatat`
  count.font = { name: 'Aptos', size: 10, color: { argb: 'FF61788A' } }
  count.alignment = { vertical: 'middle', indent: 1 }
  sheet.mergeCells('D4:E4')
  const confirmed = sheet.getCell('D4')
  const revenue = orders.filter(order => order.status === 'CONFIRMED' || order.status === 'FULFILLED').reduce((sum, order) => sum + order.total, 0)
  confirmed.value = `Nilai terkonfirmasi: Rp ${new Intl.NumberFormat('id-ID').format(revenue)}`
  confirmed.font = { name: 'Aptos', size: 10, bold: true, color: { argb: blue } }
  confirmed.alignment = { vertical: 'middle', horizontal: 'right' }
  sheet.getRow(4).height = 25
  sheet.getRow(5).height = 12

  const headers = ['Nomor Pesanan', 'Pelanggan', 'Status', 'Total', 'Tanggal']
  const header = sheet.getRow(6)
  header.values = headers
  header.height = 30
  header.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: blue } }
    cell.alignment = { vertical: 'middle', horizontal: Number(cell.col) === 4 ? 'right' : 'left', indent: Number(cell.col) === 4 ? 0 : 1 }
  })

  if (orders.length === 0) {
    sheet.mergeCells('A7:E7')
    const empty = sheet.getCell('A7')
    empty.value = 'Belum ada pesanan untuk toko ini.'
    empty.font = { name: 'Aptos', italic: true, color: { argb: 'FF718596' } }
    empty.alignment = { vertical: 'middle', indent: 1 }
    sheet.getRow(7).height = 34
  }

  for (const [index, order] of orders.entries()) {
    const row = sheet.addRow({
      number: order.number,
      customer: order.customerName,
      status: statusLabels[order.status],
      total: order.total,
      date: order.createdAt
    })
    row.height = 27
    row.eachCell(cell => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: ink } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? pale : white } }
      cell.alignment = { vertical: 'middle', horizontal: Number(cell.col) === 4 ? 'right' : 'left', indent: Number(cell.col) === 4 ? 0 : 1 }
      cell.border = { bottom: { style: 'hair', color: { argb: border } } }
    })
    const status = row.getCell(3)
    status.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors[order.status].background } }
    status.font = { name: 'Aptos', size: 10, bold: true, color: { argb: statusColors[order.status].foreground } }
    row.getCell(4).numFmt = '"Rp" #,##0;[Red]("Rp" #,##0)'
    row.getCell(5).numFmt = 'dd mmm yyyy, hh:mm'
  }

  sheet.autoFilter = { from: 'A6', to: `E${Math.max(7, 6 + orders.length)}` }
  sheet.pageSetup.printTitlesRow = '1:6'
  sheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
  sheet.headerFooter.oddFooter = 'Stokita • &P / &N'
  return workbook
}
