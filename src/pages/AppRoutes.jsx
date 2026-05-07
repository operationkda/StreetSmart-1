import { Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage.jsx'
import { AdminPage } from '@/pages/AdminPage.jsx'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
