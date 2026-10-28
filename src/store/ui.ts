import { reactive } from 'vue'

/** 轻量全局 UI 状态（词典弹窗、通知抽屉、搜索等） */
export const uiState = reactive({
  glossaryId: '',
  notificationsOpen: false,
  searchOpen: false,
})

export function openGlossary(id: string) {
  uiState.glossaryId = id
}
