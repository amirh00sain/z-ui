import { useAuthStore } from '@/store/auth'
import { AdminManager } from '@/components/AdminManager'
import { Section } from './shared'

// Admins: super admins only; regular admins opening the URL directly get a notice (the backend returns 403 too)
export default function AdminsSection() {
  const role = useAuthStore((s) => s.role)
  if (role !== 'super_admin') {
    return (
      <Section title="Admin accounts" description="Only super admins can manage sign-in accounts.">
        <p className="text-sm text-soft">This account is a regular admin. To change your own password, use Change password in the avatar menu at the top right.</p>
      </Section>
    )
  }
  return <AdminManager />
}
