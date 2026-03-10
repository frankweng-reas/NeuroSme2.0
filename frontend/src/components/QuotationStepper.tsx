/** 報價流程四步驟 Stepper */
import { Check } from 'lucide-react'

const STEPS = [
  { num: 1, label: '需求解析' },
  { num: 2, label: '品項精修' },
  { num: 3, label: '格式封裝' },
  { num: 4, label: '發送跟進' },
] as const

export interface QuotationStepperProps {
  currentStep: 1 | 2 | 3 | 4
  completedSteps: number[]
  onStepClick?: (step: number) => void
}

export default function QuotationStepper({
  currentStep,
  completedSteps,
  onStepClick,
}: QuotationStepperProps) {
  return (
    <nav className="grid grid-cols-7 items-center gap-0" aria-label="報價流程步驟">
      {STEPS.flatMap((step, idx) => {
        const isCompleted = completedSteps.includes(step.num)
        const isCurrent = currentStep === step.num
        const canClick = isCompleted && onStepClick

        const stepEl = (
          <div key={step.num} className="flex justify-center">
            <button
              type="button"
              onClick={() => canClick && onStepClick(step.num)}
              disabled={!canClick}
              className={`flex flex-row items-center gap-1.5 rounded-xl py-1 px-2 transition-all ${
                canClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`步驟 ${step.num}：${step.label}`}
            >
              <span
                className={`flex shrink-0 items-center justify-center rounded-full text-base font-semibold transition-all ${
                  isCompleted && isCurrent
                    ? 'h-9 w-9 border-2 border-sky-600 bg-sky-50 text-sky-700 ring-2 ring-sky-200'
                    : isCompleted
                      ? 'h-8 w-8 bg-gray-700 text-white'
                      : isCurrent
                        ? 'h-9 w-9 border-2 border-sky-600 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
                        : 'h-8 w-8 border border-gray-300 bg-gray-100 text-gray-500'
                }`}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : step.num}
              </span>
              <span
                className={`whitespace-nowrap font-medium ${
                  isCurrent ? 'text-lg text-sky-800' : isCompleted ? 'text-lg text-gray-600' : 'text-lg text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </button>
          </div>
        )
        const connectorEl =
          idx < STEPS.length - 1 ? (
            <div
              key={`connector-${step.num}`}
              className={`h-0.5 rounded-full transition-colors ${
                completedSteps.includes(step.num) ? 'bg-sky-500' : 'bg-gray-200'
              }`}
              aria-hidden
            />
          ) : null
        return [stepEl, connectorEl].filter(Boolean)
      })}
    </nav>
  )
}
