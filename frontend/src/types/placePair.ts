export type PlaceType = '山川' | '村镇' | '衙署' | '桥梁'
export type Certainty = '确定' | '存疑' | '待考'

export interface PlacePair {
  id: string
  sheetId: string
  oldName: string
  newName: string
  aliasList: string[]
  placeType: PlaceType
  coordNote: string
  certainty: Certainty
}

export const PLACE_TYPES: PlaceType[] = ['山川', '村镇', '衙署', '桥梁']
export const CERTAINTIES: Certainty[] = ['确定', '存疑', '待考']
