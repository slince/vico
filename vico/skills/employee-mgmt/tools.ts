import type { SkillTool } from '@vico/server/skill/types';

// Mock employee data for demo purposes
const mockEmployees = [
  { id: '1', name: '张三', dept: '工程部', position: '高级工程师', phone: '13800138001', email: 'zhangsan@company.com', status: '在职' },
  { id: '2', name: '李四', dept: '工程部', position: '项目经理', phone: '13800138002', email: 'lisi@company.com', status: '在职' },
  { id: '3', name: '王五', dept: '设计部', position: 'UI设计师', phone: '13800138003', email: 'wangwu@company.com', status: '在职' },
  { id: '4', name: '赵六', dept: '市场部', position: '市场经理', phone: '13800138004', email: 'zhaoliu@company.com', status: '休假中' },
  { id: '5', name: '孙七', dept: '财务部', position: '会计', phone: '13800138005', email: 'sunqi@company.com', status: '在职' },
];

const mockAttendances: Record<string, { date: string; checkIn: string; checkOut: string; status: string }[]> = {
  '1': [
    { date: '2026-06-10', checkIn: '08:55', checkOut: '18:10', status: '正常' },
    { date: '2026-06-09', checkIn: '09:05', checkOut: '17:55', status: '迟到' },
    { date: '2026-06-08', checkIn: '08:50', checkOut: '18:30', status: '正常' },
  ],
  '2': [
    { date: '2026-06-10', checkIn: '08:45', checkOut: '19:00', status: '正常' },
  ],
};

export const tools: SkillTool[] = [
  {
    definition: {
      name: 'list_employees',
      description: '查询员工列表，支持按部门、职位或姓名搜索',
      parameters: {
        type: 'object',
        properties: {
          dept: { type: 'string', description: '部门名称，可选' },
          position: { type: 'string', description: '职位名称，可选' },
          search: { type: 'string', description: '姓名搜索关键词，可选' },
        },
      },
    },
    handler: async (args: { dept?: string; position?: string; search?: string }) => {
      let result = [...mockEmployees];
      if (args.dept) result = result.filter((e) => e.dept.includes(args.dept!));
      if (args.position) result = result.filter((e) => e.position.includes(args.position!));
      if (args.search) result = result.filter((e) => e.name.includes(args.search!));
      return { count: result.length, employees: result };
    },
  },
  {
    definition: {
      name: 'get_employee',
      description: '获取单个员工的详细信息',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '员工姓名' },
        },
        required: ['name'],
      },
    },
    handler: async (args: { name: string }) => {
      const emp = mockEmployees.find(
        (e) => e.name === args.name || e.name.includes(args.name)
      );
      if (!emp) return { error: `未找到员工: ${args.name}` };
      return emp;
    },
  },
  {
    definition: {
      name: 'query_attendance',
      description: '查询员工的考勤打卡记录',
      parameters: {
        type: 'object',
        properties: {
          employee_name: { type: 'string', description: '员工姓名' },
        },
        required: ['employee_name'],
      },
    },
    handler: async (args: { employee_name: string }) => {
      const emp = mockEmployees.find(
        (e) => e.name === args.employee_name || e.name.includes(args.employee_name)
      );
      if (!emp) return { error: `未找到员工: ${args.employee_name}` };
      const records = mockAttendances[emp.id] || [];
      return { employee: emp.name, records, count: records.length };
    },
  },
  {
    definition: {
      name: 'request_leave',
      description: '发起员工请假申请',
      parameters: {
        type: 'object',
        properties: {
          employee_name: { type: 'string', description: '员工姓名' },
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          reason: { type: 'string', description: '请假原因' },
        },
        required: ['employee_name', 'start_date', 'end_date', 'reason'],
      },
    },
    handler: async (args: { employee_name: string; start_date: string; end_date: string; reason: string }) => {
      const emp = mockEmployees.find(
        (e) => e.name === args.employee_name || e.name.includes(args.employee_name)
      );
      if (!emp) return { error: `未找到员工: ${args.employee_name}` };
      return {
        request_id: `LEAVE-${Date.now()}`,
        employee: emp.name,
        dept: emp.dept,
        start_date: args.start_date,
        end_date: args.end_date,
        reason: args.reason,
        status: '已提交，等待审批',
      };
    },
  },
];

export default tools;
