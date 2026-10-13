import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Btn, Field } from '@/components/ui/Form'
import { pushToast } from '@/lib/notify'

// Change the signed-in admin's own password (current password required). Available to every role.
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const reset = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const change = useMutation({
    mutationFn: () => authApi.changePassword(oldPassword, newPassword),
    onSuccess: () => {
      pushToast({ title: 'Password updated', description: 'Use the new password the next time you sign in.', variant: 'success' })
      reset()
      onClose()
    },
  })

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword
  const canSubmit = oldPassword !== '' && newPassword.length >= 6 && newPassword === confirmPassword

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Change password"
      size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={() => { reset(); onClose() }}>Cancel</Btn>
          <Btn loading={change.isPending} disabled={!canSubmit} onClick={() => change.mutate()}>Save</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Current password" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" />
        <Field label="New password (min 6 characters)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        <Field
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          error={mismatch ? 'The two new passwords do not match' : undefined}
        />
      </div>
    </Modal>
  )
}
