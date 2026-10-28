import type { SectorDef, SectorId } from '../types'

export const SECTORS: SectorDef[] = [
  { id: 'tech', name: '科技', short: '科技', color: '#4fc3f7', basePE: 32, cyclical: 0.4, defensive: 0.1, description: '芯片、软件、云计算与消费电子。增长预期高，对利率与情绪敏感。' },
  { id: 'consumer', name: '消费', short: '消费', color: '#ffb74d', basePE: 24, cyclical: 0.5, defensive: 0.4, description: '食品饮料、零售、旅游与可选消费。受消费者信心和收入预期影响。' },
  { id: 'health', name: '医疗', short: '医疗', color: '#81c784', basePE: 28, cyclical: 0.1, defensive: 0.8, description: '创新药、医疗器械与医疗服务。审批与研发结果是关键不确定性。' },
  { id: 'industrial', name: '工业', short: '工业', color: '#a1887f', basePE: 18, cyclical: 0.8, defensive: 0.2, description: '机械、运输、航运与基建。与经济周期和订单景气度相关。' },
  { id: 'energy', name: '能源', short: '能源', color: '#e57373', basePE: 11, cyclical: 0.9, defensive: 0.3, description: '油气、煤炭与新能源。受大宗商品价格与政策影响显著。' },
  { id: 'finance', name: '金融', short: '金融', color: '#9575cd', basePE: 9, cyclical: 0.6, defensive: 0.4, description: '银行、券商与保险。利率曲线、信用风险和市场成交量影响盈利。' },
  { id: 'materials', name: '材料', short: '材料', color: '#90a4ae', basePE: 13, cyclical: 0.9, defensive: 0.1, description: '钢铁、化工、有色金属。价格周期强，成本与需求波动大。' },
  { id: 'utilities', name: '公用事业', short: '公用', color: '#4db6ac', basePE: 15, cyclical: 0.1, defensive: 0.9, description: '电力、水务与燃气。现金流稳定、分红较高，对利率敏感。' },
  { id: 'realestate', name: '地产', short: '地产', color: '#f06292', basePE: 10, cyclical: 0.8, defensive: 0.2, description: '住宅开发、商业地产与物业服务。高杠杆、对利率与信贷敏感。' },
  { id: 'telecom', name: '通信', short: '通信', color: '#7986cb', basePE: 17, cyclical: 0.3, defensive: 0.6, description: '运营商、通信设备与传媒。现金流稳健，技术升级周期带来资本开支。' },
]

export const SECTOR_MAP: Record<SectorId, SectorDef> = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<SectorId, SectorDef>
