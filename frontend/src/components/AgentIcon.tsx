/** 依 icon_name 顯示對應 Lucide 圖示，無則用 MessageCircle */
import {
  MessageCircle,
  Bot,
  Sparkles,
  Brain,
  User,
  Zap,
  ChartNoAxesCombined,
  UsersRound,
  Calculator,
  Calendar,
  BookOpen,
  Headphones,
  FileText,
  FilePen,
  FileQuestion,
  Megaphone,
  ScanText,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  MessageCircle,
  Bot,
  Sparkles,
  Brain,
  User,
  Zap,
  ChartNoAxesCombined,
  UsersRound,
  Calculator,
  Calendar,
  BookOpen,
  'book-open': BookOpen,
  Headphones,
  FileText,
  FilePen,
  FileQuestion,
  Megaphone,
  ScanText,
}

const DEFAULT_ICON = MessageCircle

interface AgentIconProps {
  iconName: string | null | undefined
  className?: string
}

export default function AgentIcon({ iconName, className = 'h-8 w-8 text-gray-600' }: AgentIconProps) {
  const Icon = iconName && ICON_MAP[iconName] ? ICON_MAP[iconName] : DEFAULT_ICON
  return <Icon className={className} />
}
