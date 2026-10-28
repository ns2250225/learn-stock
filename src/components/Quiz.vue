<script setup lang="ts">
import { ref, watch } from 'vue'
import type { QuizQuestion } from '../engine/types'
const props = defineProps<{ questions: QuizQuestion[]; submitLabel?: string }>()
const emit = defineEmits<{ submit: [answers: number[]] }>()
const answers = ref<number[]>(props.questions.map(() => -1))
const graded = ref(false)
watch(
  () => props.questions,
  () => {
    answers.value = props.questions.map(() => -1)
    graded.value = false
  },
)
function submit() {
  graded.value = true
  emit('submit', answers.value.slice())
}
function retry() {
  answers.value = props.questions.map(() => -1)
  graded.value = false
}
</script>

<template>
  <div class="col gap-lg">
    <div v-for="(q, qi) in questions" :key="q.id" class="panel inset">
      <div class="bold mb">{{ qi + 1 }}. {{ q.question }}</div>
      <div class="col gap-sm">
        <label
          v-for="(o, oi) in q.options"
          :key="oi"
          class="check opt"
          :class="{ right: graded && oi === q.answer, wrong: graded && answers[qi] === oi && oi !== q.answer }"
        >
          <input v-model="answers[qi]" type="radio" :name="q.id" :value="oi" :disabled="graded" />
          <span>{{ o }}</span>
          <span v-if="graded && oi === q.answer" class="ok">✔ 正确答案</span>
          <span v-else-if="graded && answers[qi] === oi" class="danger">✘ 你的选择</span>
        </label>
      </div>
      <div v-if="graded" class="note mt-sm" :class="answers[qi] === q.answer ? 'ok' : 'danger'">{{ q.explanation }}</div>
    </div>
    <div class="row end">
      <button v-if="graded" class="btn btn-ghost" @click="retry">重新作答</button>
      <button v-else class="btn btn-primary" :disabled="answers.some((a) => a < 0)" @click="submit">{{ submitLabel ?? '提交答案' }}</button>
    </div>
  </div>
</template>

<style scoped>
.opt {
  padding: 4px 6px;
}
.opt.right {
  background: rgba(123, 211, 137, 0.12);
}
.opt.wrong {
  background: rgba(255, 107, 107, 0.12);
}
</style>
