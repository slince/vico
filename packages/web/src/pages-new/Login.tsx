import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

/**
 * 登录页面组件
 *
 * 提供用户名/密码表单，调用认证 Hook 的 login 方法完成登录，
 * 成功后跳转至 /dashboard。登录失败时通过 Alert 组件展示错误信息。
 *
 * 布局采用渐变背景 + 居中卡片，底部展示默认账号提示。
 *
 * @returns 登录页面 JSX 元素
 */
export default function Login() {
  /** 用户名输入框的受控状态 */
  const [username, setUsername] = useState('');
  /** 密码输入框的受控状态 */
  const [password, setPassword] = useState('');
  /** 登录失败时的错误消息，为空表示无错误 */
  const [error, setError] = useState('');
  /** 登录请求进行中的加载状态，用于禁用按钮和展示 Spinner */
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  /**
   * 处理登录表单提交
   *
   * 阻止默认表单行为，清空旧错误，设置加载态，
   * 调用 login 方法并跳转至仪表盘。
   * 若登录失败则捕获异常并展示错误消息。
   *
   * @param e - 表单提交事件
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); // 清空上一次的错误信息
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard'); // 登录成功后跳转到仪表盘
    } catch (err: any) {
      setError(err.message || '登录失败，请检查用户名或密码');
    } finally {
      setLoading(false); // 无论成功或失败，结束加载状态
    }
  };

  return (
    // 渐变背景，垂直水平居中
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      {/* 限制卡片最大宽度，保持视觉聚焦 */}
      <div className="w-full max-w-sm px-4">
        <Card>
          <CardHeader className="text-center pb-2">
            {/* 品牌名称 */}
            <CardTitle className="text-2xl font-bold tracking-tight">Vico</CardTitle>
            {/* 副标题 */}
            <CardDescription>AI Agent 管理平台</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 错误信息：使用 Alert 组件替代原生 div */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* 用户名字段 */}
              <div className="space-y-1.5">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  required
                  disabled={loading}
                />
              </div>

              {/* 密码字段 */}
              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  required
                  disabled={loading}
                />
              </div>

              {/* 提交按钮：loading 时展示 Spinner */}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Spinner className="mr-2" />
                    登录中...
                  </>
                ) : (
                  '登 录'
                )}
              </Button>
            </form>
          </CardContent>

          {/* 底部默认账号提示 */}
          <div className="px-(--card-spacing) pb-(--card-spacing)">
            <p className="text-xs text-muted-foreground text-center">
              默认账号: admin / admin123
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
