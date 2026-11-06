/**
 * lib/organizer/notify.js — in-app notifications for organizer to-dos.
 */
import { createNotification } from '@/lib/createNotification'

/** Tell a newly assigned user about a to-do (never the person who assigned it). */
export async function notifyTodoAssignee({ assigneeId, actorId, todoTitle, organizer }) {
  if (!assigneeId || String(assigneeId) === String(actorId)) return
  const organizerId = String(organizer?._id ?? organizer?.id ?? '')
  await createNotification({
    userId:  String(assigneeId),
    title:   'To-do assigned to you',
    message: organizer?.name ? `"${todoTitle}" in ${organizer.name}` : `"${todoTitle}"`,
    type:    'TASK',
    link:    organizerId ? `/admin/organizer/${organizerId}?tab=todo` : '/admin/organizer?tab=todo',
  })
}
