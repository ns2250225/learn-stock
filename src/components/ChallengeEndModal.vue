<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './Modal.vue'
import Quiz from './Quiz.vue'
import { useGame } from '../store/game'
import { CHALLENGE_MAP, challengeMetrics, finishChallenge, goalLabelDetail } from '../engine/challenge'
import { addXp, gradeQuiz } from '../engine/profile'
import type { QuizQuestion } from '../engine/types'

const game = useGame()
const run = computed(() => {
  game.rev
  return game.engine?.w.challenge
})
const def = computed(() => (run.value ? CHALLENGE_MAP[run.value.id] : undefined))
const quizQs = computed<QuizQuestion[]>(() => {
  const q = def.value?.goals.find((g) => g.goal.type === 'quiz')?.goal
  return q && q.type === 'quiz' ? q.questions : []
})
const answers = ref<number[] | null>(null)
const metrics = computed(() => {
  game.rev
  return game.engine && run.value ? challengeMetrics(game.engine) : []
})
const preview = computed(() => {
  game.rev
  const e = game.engine
  if (!e || !def.value) return []
  return def.value.goals.map((g) => ({ label: g.label, required: g.required, ...goalLabelDetail(e, g.goal, answers.value ?? undefined) }))
})
const finished = computed(() => !!run.value?.finished)

function submit() {
  const e = game.engine
  if (!e || !def.value) return
  const r = finishChallenge(e, answers.value ?? undefined)
  if (!r) return
  if (quizQs.value.length && answers.value) gradeQuiz(e, game.profile, `挑战：${def.value.title}`, quizQs.value, answers.value)
  game.profile.challengeRecords.push({
    id: r.id,
    won: !!r.won,
    at: new Date().toISOString(),
    seed: e.w.meta.worldSeed,
    metrics: challengeMetrics(e),
    results: r.results ?? [],
  })
  const x = addXp(game.profile, r.won ? 150 : 40, `${r.won ? '通过' : '完成'}挑战：${def.value.title}`)
  game.toast(r.won ? 'success' : 'info', r.won ? '挑战通过！' : '挑战结束', `+${r.won ? 150 : 40} 经验${x.leveledUp ? ` · 升级到 Lv.${x.level}` : ''}`)
  void game.saveProfile()
  game.after()
}
function close() {
  game.challengeEndOpen = false
  game.after()
}
async function again() {
  const d = def.value
  if (!d) return
  game.challengeEndOpen = false
  await game.newGame({ name: game.profile.name, mode: 'challenge', rulesId: d.rulesId ?? 'teaching', difficulty: 'normal', seed: 'CH-' + Math.random().toString(36).slice(2, 8).toUpperCase(), initialCash: d.startCash, challengeId: d.id })
  game.engine?.setFlag('read_disclaimer')
  game.after()
}
function toLearn() {
  close()
  game.go('learn', 'challenges')
}
</script>

<template>
  <Modal v-if="run && def" :title="`挑战结束 · ${def.title}`" size="wide" :closable="finished" @close="close">
    <div v-if="finished" class="note mb" :class="run.won ? 'ok' : 'warn'">
      <span class="bold">{{ run.won ? '🏆 挑战通过' : '挑战未通过' }}</span> — 结果综合考虑风险控制、过程纪律与学习目标，而不仅是收益率。
    </div>
    <div class="grid-2">
      <div class="panel inset">
        <div class="section-title">表现指标</div>
        <div class="kv"><template v-for="m in metrics" :key="m.label"><span>{{ m.label }}</span><span>{{ m.value }}</span></template></div>
      </div>
      <div class="panel inset">
        <div class="section-title">目标完成情况</div>
        <div v-for="(g, i) in finished ? run.results ?? [] : preview" :key="i" class="small mb">
          <span :class="g.pass ? 'ok' : 'danger'">{{ g.pass ? '✔' : '✘' }}</span>
          <span class="bold"> {{ g.label }}</span>
          <span class="tag" :class="g.required ? 'tag-accent' : ''" style="margin-left: 4px">{{ g.required ? '必须' : '加分' }}</span>
          <div class="tiny muted">{{ g.detail }}</div>
        </div>
      </div>
    </div>
    <div v-if="!finished && quizQs.length" class="mt">
      <div class="section-title">结业测验</div>
      <Quiz :questions="quizQs" submit-label="确认答案" @submit="(a) => (answers = a)" />
    </div>
    <div v-if="finished" class="panel inset mt">
      <div class="section-title">复盘讲解</div>
      <p class="small prose">{{ def.debrief }}</p>
    </div>
    <template #footer>
      <template v-if="!finished">
        <span v-if="quizQs.length && !answers" class="tiny warn grow">请先完成结业测验</span>
        <button class="btn btn-primary" :disabled="quizQs.length > 0 && !answers" @click="submit">提交结果</button>
      </template>
      <template v-else>
        <button class="btn btn-ghost" @click="toLearn">返回学习中心</button>
        <button class="btn btn-ghost" @click="again">再来一次</button>
        <button class="btn btn-primary" @click="close">继续自由交易</button>
      </template>
    </template>
  </Modal>
</template>
