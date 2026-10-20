import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** GET /api — index of all KhoTruyện AI API endpoints. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    name: 'KhoTruyện AI API',
    endpoints: [
      { method: 'GET', path: '/api/stats', desc: 'Thống kê tổng quan + trạng thái engine' },
      { method: 'GET', path: '/api/settings', desc: 'Đọc cài đặt ứng dụng' },
      { method: 'PUT', path: '/api/settings', desc: 'Cập nhật cài đặt ứng dụng' },
      { method: 'GET', path: '/api/keys', desc: 'Danh sách API key Gemini' },
      { method: 'POST', path: '/api/keys', desc: 'Thêm API key Gemini' },
      { method: 'PATCH', path: '/api/keys/{id}', desc: 'Sửa API key (active/label)' },
      { method: 'DELETE', path: '/api/keys/{id}', desc: 'Xoá API key' },
      { method: 'GET', path: '/api/novels?q=', desc: 'Danh sách truyện (tìm theo tên/tác giả)' },
      { method: 'GET', path: '/api/novels/{id}', desc: 'Chi tiết truyện + danh sách chương' },
      { method: 'GET', path: '/api/novels/{id}/chapters/{idx}', desc: 'Nội dung một chương' },
      { method: 'DELETE', path: '/api/novels/{id}', desc: 'Xoá truyện (qua engine)' },
      { method: 'GET', path: '/api/jobs', desc: '100 job gần nhất' },
      { method: 'GET', path: '/api/logs', desc: 'Log engine (qua engine)' },
      { method: 'POST', path: '/api/engine/preview', desc: 'Xem trước link truyện' },
      { method: 'POST', path: '/api/engine/scrape', desc: 'Tạo job cào truyện' },
      { method: 'POST', path: '/api/engine/translate', desc: 'Tạo job dịch truyện' },
      { method: 'POST', path: '/api/engine/retry', desc: 'Cào lại các chương lỗi' },
      { method: 'POST', path: '/api/engine/jobs/{id}/{action}', desc: 'cancel/pause/resume job' },
      { method: 'GET', path: '/api/supabase/schema', desc: 'DDL schema Supabase' },
      { method: 'POST', path: '/api/supabase/test', desc: 'Kiểm tra kết nối Supabase' },
      { method: 'POST', path: '/api/supabase/sync', desc: 'Đẩy dữ liệu lên Supabase' },
      { method: 'POST', path: '/api/supabase/pull', desc: 'Kéo dữ liệu từ Supabase về' },
      { method: 'GET', path: '/api/export', desc: 'Tài liệu API xuất truyện công khai' },
    ],
  })
}
