// The popup: data (messages and polling) → view model (UI.md §4 state table) → PopupView (render).
// Three layers, each testable on its own and reusable by the gallery
import { PopupView } from './PopupView'
import { usePopupData } from './data'
import { derivePopupView } from './view-model'

export function App() {
  const { input, error, copied, actions } = usePopupData()
  return <PopupView view={derivePopupView(input)} error={error} copied={copied} actions={actions} />
}
