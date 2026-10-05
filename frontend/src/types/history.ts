export type NameChangeType = '初置' | '改名' | '迁治' | '废置'

export interface NameHistory {
  id: string
  placePairId: string
  period: string
  name: string
  changeType: NameChangeType
  sourceRef: string
  note: string
}

export const NAME_CHANGE_TYPES: NameChangeType[] = ['初置', '改名', '迁治', '废置']
