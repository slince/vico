import {ModelSelector} from "./elements/model-selector.aui";

export function ModelSelectorAction() {
  return (
    <ModelSelector
      models={[
        { id: "gpt-6-luna", name: "GPT-6 Luna", description: "Fast and efficient" },
        { id: "gpt-6-sol", name: "GPT-6 Sol", description: "Balanced performance" },
        { id: "gpt-6-astra", name: "GPT-6 Astra", description: "Most capable", efforts: true },
      ]}
      defaultValue="gpt-6-luna"
      defaultEffort="medium"
      size="sm"
    />
  );
}