// 分析ページが使うデータ（会計の仕訳・営業・レシピ原価）をまとめて取得し、月ごとの理論原価などを用意する。
import { useMemo } from 'react'
import { useJournalEntries, monthRange } from './accounting'
import { useClosedSessions, useReceiptLines, salesBySession } from './analytics'
import {
  useAllRecipeIngredients,
  useAllMenuComponents,
  groupRecipeIngredientsByRecipe,
  menuCost,
  perServingCost,
  useRecipes,
  useAllMenus,
  type MenuComponentRow,
} from './masterData'
import { shiftMonth, theoreticalFoodCostByMonth } from './analysis'
import { theoreticalFoodCostBySession } from './sessionStats'
import { usePersistedState } from './persistState'

// 選択中の月から過去 months か月分の仕訳を取る（推移グラフ用）
export function useAnalysisData(month: string, months = 6) {
  const range = useMemo(
    () => ({ from: monthRange(shiftMonth(month, -(months - 1))).from, to: monthRange(month).to }),
    [month, months],
  )
  const journal = useJournalEntries(range)
  const sessions = useClosedSessions()
  const lines = useReceiptLines()
  const recipeItems = useAllRecipeIngredients()
  const components = useAllMenuComponents()
  const recipes = useRecipes()
  const allMenus = useAllMenus()
  // 取り置き特典に使うレシピ（設定タブで選ぶ。ダッシュボードと同じキー）
  const [toriokiRecipeId] = usePersistedState('kbtr_v3_torioki_recipe', '')

  // メニューID → 1食あたりの原価（税込・理論値）。ダッシュボードと同じ計算
  const costByMenuId = useMemo(() => {
    const byRecipe = groupRecipeIngredientsByRecipe(recipeItems.data ?? [])
    const byMenu: Record<string, MenuComponentRow[]> = {}
    for (const c of components.data ?? []) (byMenu[c.menu_id] ??= []).push(c)
    const map: Record<string, number> = {}
    for (const [menuId, comps] of Object.entries(byMenu)) map[menuId] = menuCost(comps, byRecipe)
    return map
  }, [recipeItems.data, components.data])

  const foodBySession = useMemo(
    () => theoreticalFoodCostBySession(lines.data ?? [], costByMenuId),
    [lines.data, costByMenuId],
  )

  // 取り置き特典1食あたりの原価（レシピ未選択なら0）
  const reservedCostPerServing = useMemo(() => {
    const r = (recipes.data ?? []).find((x) => x.id === toriokiRecipeId)
    if (!r) return 0
    const byRecipe = groupRecipeIngredientsByRecipe(recipeItems.data ?? [])
    return perServingCost(r, byRecipe[r.id] ?? [])
  }, [recipes.data, recipeItems.data, toriokiRecipeId])

  const salesMap = useMemo(() => salesBySession(lines.data ?? []), [lines.data])
  const theoreticalByMonth = useMemo(
    () => theoreticalFoodCostByMonth(sessions.data ?? [], lines.data ?? [], costByMenuId),
    [sessions.data, lines.data, costByMenuId],
  )

  return {
    entries: journal.data ?? [],
    sessions: sessions.data ?? [],
    lines: lines.data ?? [],
    salesMap,
    costByMenuId,
    allMenus: allMenus.data ?? [],
    theoreticalByMonth,
    foodBySession,
    reservedCostPerServing,
    loading: journal.isLoading || sessions.isLoading || lines.isLoading,
    error: (journal.error ?? sessions.error ?? lines.error) as Error | null,
  }
}
