当前的mastra用法是不对的，mastra不允许动态创建子agent；所以调整下用法；

1. 必须接入  @mastra/hono； 
2. agent/agents 目录下创建两个 agent 

一个是vico agent（默认主agent） 他的定位是通用agent, 可以将用户的任务提交给llm，根据llm的提示，将用户的任务拆解成不同的子任务交给不同的agent
agent 可以是用户自定义好的，也可以是临时的一次性agent，交给llm 去判断，最终汇总agent的输出结果返回给用户；该agent的配置

二个是 通用 agent 代理模板；由于mastra 不支持动态注册agent，所以需要将用户在页面上配置的agent当成配置，用户请求的时候 构造不同的requestcontext 去请求该agent；


上述两个agent在，启动的时候就要注册到mastra 容器上；



