import type { SkillTool } from '@vico/server/skill/types';

// Mock material price data
const materialPrices: Record<string, { unit: string; price: number; supplier: string }> = {
  '水泥': { unit: '吨', price: 420, supplier: '建材供应商A' },
  '钢筋': { unit: '吨', price: 3850, supplier: '钢铁贸易公司B' },
  '沙子': { unit: '立方米', price: 120, supplier: '建材供应商A' },
  '碎石': { unit: '立方米', price: 95, supplier: '建材供应商A' },
  '红砖': { unit: '千块', price: 550, supplier: '砖厂C' },
  '混凝土C30': { unit: '立方米', price: 480, supplier: '搅拌站D' },
  '防水卷材': { unit: '平方米', price: 28, supplier: '防水材料公司E' },
  'PVC管DN100': { unit: '米', price: 35, supplier: '管道供应商F' },
  '电线2.5mm²': { unit: '米', price: 3.5, supplier: '电缆公司G' },
  '涂料': { unit: '公斤', price: 45, supplier: '涂料厂商H' },
  '瓷砖': { unit: '平方米', price: 85, supplier: '瓷砖批发商I' },
  '木材': { unit: '立方米', price: 2200, supplier: '木材市场J' },
};

// Mock labor cost data
const laborCosts: Record<string, { unit: string; price: number }> = {
  '瓦工': { unit: '工日', price: 400 },
  '木工': { unit: '工日', price: 450 },
  '钢筋工': { unit: '工日', price: 420 },
  '混凝土工': { unit: '工日', price: 380 },
  '电工': { unit: '工日', price: 500 },
  '水暖工': { unit: '工日', price: 480 },
  '油漆工': { unit: '工日', price: 350 },
  '普通力工': { unit: '工日', price: 280 },
  '项目经理': { unit: '月', price: 18000 },
  '安全员': { unit: '月', price: 12000 },
};

export const tools: SkillTool[] = [
  {
    definition: {
      name: 'search_material_price',
      description: '查询工程材料/物料的当前市场价格',
      parameters: {
        type: 'object',
        properties: {
          material_name: { type: 'string', description: '材料名称，支持模糊搜索' },
        },
        required: ['material_name'],
      },
    },
    handler: async (args: { material_name: string }) => {
      const keywords = args.material_name.toLowerCase();
      const results = Object.entries(materialPrices)
        .filter(([name]) => name.toLowerCase().includes(keywords))
        .map(([name, info]) => ({ name, ...info }));
      if (results.length === 0) {
        return { message: `未找到材料"${args.material_name}"的价格信息，请提供更多信息或联系采购部门`, results: [] };
      }
      return { count: results.length, results };
    },
  },
  {
    definition: {
      name: 'search_labor_cost',
      description: '查询各工种的劳动力成本标准',
      parameters: {
        type: 'object',
        properties: {
          job_type: { type: 'string', description: '工种名称，如"瓦工"、"电工"等' },
        },
        required: ['job_type'],
      },
    },
    handler: async (args: { job_type: string }) => {
      const keywords = args.job_type.toLowerCase();
      const results = Object.entries(laborCosts)
        .filter(([name]) => name.toLowerCase().includes(keywords))
        .map(([name, info]) => ({ job: name, ...info }));
      if (results.length === 0) {
        return { message: `未找到工种"${args.job_type}"的成本标准`, results: [] };
      }
      return { count: results.length, results };
    },
  },
  {
    definition: {
      name: 'calculate_quotation',
      description: '根据输入的材料清单和人工清单计算工程报价总金额',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '项目名称' },
          materials: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
              },
            },
            description: '材料清单 [{name, quantity}]',
          },
          labor: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                job: { type: 'string' },
                days: { type: 'number' },
                workers: { type: 'number' },
              },
            },
            description: '人工清单 [{job, days, workers}]',
          },
          profit_margin: { type: 'number', description: '利润率(%)，默认15' },
          tax_rate: { type: 'number', description: '税率(%)，默认13' },
        },
        required: ['project_name', 'materials', 'labor'],
      },
    },
    handler: async (args: {
      project_name: string;
      materials: { name: string; quantity: number }[];
      labor: { job: string; days: number; workers: number }[];
      profit_margin?: number;
      tax_rate?: number;
    }) => {
      const profitMargin = (args.profit_margin ?? 15) / 100;
      const taxRate = (args.tax_rate ?? 13) / 100;

      // Calculate material costs
      const materialDetails = args.materials.map((m) => {
        const info = materialPrices[m.name];
        const unitPrice = info?.price ?? 0;
        const total = unitPrice * m.quantity;
        return { name: m.name, quantity: m.quantity, unitPrice, unit: info?.unit ?? '单位', total };
      });
      const totalMaterial = materialDetails.reduce((s, m) => s + m.total, 0);

      // Calculate labor costs
      const laborDetails = args.labor.map((l) => {
        const info = laborCosts[l.job];
        const dailyRate = info?.price ?? 0;
        const total = dailyRate * l.days * l.workers;
        return { job: l.job, workers: l.workers, days: l.days, dailyRate, total };
      });
      const totalLabor = laborDetails.reduce((s, l) => s + l.total, 0);

      // Calculate overhead, profit, tax
      const managementFee = (totalMaterial + totalLabor) * 0.05;
      const profit = (totalMaterial + totalLabor + managementFee) * profitMargin;
      const tax = (totalMaterial + totalLabor + managementFee + profit) * taxRate;
      const grandTotal = totalMaterial + totalLabor + managementFee + profit + tax;

      return {
        project_name: args.project_name,
        breakdown: {
          material_cost: totalMaterial,
          labor_cost: totalLabor,
          management_fee: managementFee,
          profit,
          tax,
          grand_total: grandTotal,
        },
        material_details: materialDetails,
        labor_details: laborDetails,
        profit_margin_percent: args.profit_margin ?? 15,
        tax_rate_percent: args.tax_rate ?? 13,
      };
    },
  },
  {
    definition: {
      name: 'generate_quotation_doc',
      description: '生成结构化的工程报价方案文档',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '项目名称' },
          client_name: { type: 'string', description: '客户名称' },
          quotation_data: { type: 'object', description: '由 calculate_quotation 返回的计算结果' },
        },
        required: ['project_name', 'quotation_data'],
      },
    },
    handler: async (args: { project_name: string; client_name?: string; quotation_data: any }) => {
      const q = args.quotation_data;
      const doc = `
# 工程报价方案

## 项目信息
- **项目名称**: ${args.project_name}
- **客户名称**: ${args.client_name || '未指定'}
- **报价日期**: ${new Date().toLocaleDateString('zh-CN')}
- **有效期**: 30天

## 费用明细

### 一、材料费用
| 材料名称 | 数量 | 单价(元) | 金额(元) |
|----------|------|----------|----------|
${(q.material_details || []).map((m: any) => `| ${m.name} | ${m.quantity} ${m.unit} | ${m.unitPrice.toFixed(2)} | ${m.total.toFixed(2)} |`).join('\n')}
| **小计** | | | **${q.breakdown.material_cost.toFixed(2)}** |

### 二、人工费用
| 工种 | 人数 | 天数 | 日薪(元) | 金额(元) |
|------|------|------|----------|----------|
${(q.labor_details || []).map((l: any) => `| ${l.job} | ${l.workers} | ${l.days} | ${l.dailyRate.toFixed(2)} | ${l.total.toFixed(2)} |`).join('\n')}
| **小计** | | | | **${q.breakdown.labor_cost.toFixed(2)}** |

### 三、费用汇总
| 项目 | 金额(元) |
|------|----------|
| 材料费 | ${q.breakdown.material_cost.toFixed(2)} |
| 人工费 | ${q.breakdown.labor_cost.toFixed(2)} |
| 管理费(5%) | ${q.breakdown.management_fee.toFixed(2)} |
| 利润(${q.profit_margin_percent}%) | ${q.breakdown.profit.toFixed(2)} |
| 税金(${q.tax_rate_percent}%) | ${q.breakdown.tax.toFixed(2)} |
| **总价** | **${q.breakdown.grand_total.toFixed(2)}** |

> 大写金额：待填写
> 备注：本报价不含设计费、监理费及第三方检测费用。
`;

      return {
        document: doc,
        format: 'markdown',
        project_name: args.project_name,
        total: q.breakdown.grand_total,
      };
    },
  },
];

export default tools;
