import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarGroupAction,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from "@/hooks/useThreads"
import ThreadList from "@/containers/ThreadList"
import { DeleteAllThreadsDialog } from "@/containers/dialogs/DeleteAllThreadsDialog"
import { ImportT3ChatsDialog } from "@/containers/dialogs/ImportT3ChatsDialog"

export function NavChats() {
  const { t } = useTranslation()
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const threadsWithoutProject = useMemo(() => {
    return getFilteredThreads('').filter((thread) => !thread.metadata?.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, threads])

  // No chats yet: still expose the importer so a fresh user can bring their
  // T3 Chat history in before they've created a single thread.
  if (threadsWithoutProject.length === 0) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarMenu>
          <div className="px-2">
            <ImportT3ChatsDialog />
          </div>
        </SidebarMenu>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:chats')}</SidebarGroupLabel>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal className="text-muted-foreground" />
            <span className="sr-only">More</span>
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <ImportT3ChatsDialog
            onDropdownClose={() => setDropdownOpen(false)}
          />
          <DeleteAllThreadsDialog
            onDeleteAll={deleteAllThreads}
            onDropdownClose={() => setDropdownOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarMenu>
        <ThreadList threads={threadsWithoutProject} />
      </SidebarMenu>
    </SidebarGroup>
  )
}
