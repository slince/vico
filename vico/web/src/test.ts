import {streamText, toUIMessageStream} from "ai";


streamText({
  model: openai.responses('gpt-5.5'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe what you see in this image.' },
        { type: 'file', mediaType: 'image', data: providerReference },
      ],
    },
  ],
})

toUIMessageStream()