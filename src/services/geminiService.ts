import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const sendNotificationFunction: FunctionDeclaration = {
  name: "send_notification",
  parameters: {
    type: Type.OBJECT,
    description: "Send a notification to the patient's device.",
    properties: {
      title: { type: Type.STRING, description: "The title of the notification." },
      body: { type: Type.STRING, description: "The message body of the notification." },
      type: { type: Type.STRING, enum: ["info", "urgent", "recommendation"], description: "The severity/type of the notification." }
    },
    required: ["title", "body"]
  }
};

const talkToPatientFunction: FunctionDeclaration = {
  name: "talk_to_patient",
  parameters: {
    type: Type.OBJECT,
    description: "Speak directly to the patient using text-to-speech.",
    properties: {
      message: { type: Type.STRING, description: "The message to speak to the patient." }
    },
    required: ["message"]
  }
};

const wakeUpFunction: FunctionDeclaration = {
  name: "wake_up",
  parameters: {
    type: Type.OBJECT,
    description: "Wake up the agent to start a conversation or alert the patient.",
    properties: {
      reason: { type: Type.STRING, description: "The reason for waking up (e.g., 'Scream detected', 'Patient spoke')." }
    },
    required: ["reason"]
  }
};

export const getGeminiModel = () => {
  return ai.models.generateContent.bind(ai.models);
};

export const generateHealthSummary = async (logs: any[], profile: any, medications: any[]) => {
  const prompt = `
    As a medical AI assistant, generate a concise summary for a doctor about this patient's recent health history.
    
    Patient Profile:
    - Name: ${profile.name}
    - Condition: ${profile.condition}
    - Doctor's Notes: ${profile.doctor_notes}
    
    Current Medications:
    ${medications.map(m => `- ${m.name} (${m.dosage}, ${m.frequency}) at ${m.time}`).join('\n')}
    
    Recent Logs (Last 20 entries):
    ${logs.slice(0, 20).map(l => `- ${l.timestamp}: ${l.medication_name || 'General'} - Status: ${l.status}, Mood: ${l.mood}, Notes: ${l.notes}`).join('\n')}
    
    Please provide:
    1. A summary of medication adherence.
    2. Trends in mood or symptoms.
    3. Any critical alerts or missed doses that need immediate attention.
    4. A concise "Doctor's Brief" for quick decision making.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Error generating summary:", error);
    return "Failed to generate summary. Please check your connection and API key.";
  }
};

export const getAIAgentResponse = async (message: string, context: any) => {
  const prompt = `
    You are MediSafe Agent, a supportive AI companion for a patient with chronic illness.
    Your goal is to help them manage their health, stay positive, and ensure they take their meds.
    
    Context:
    - Patient Name: ${context.profile.name}
    - Condition: ${context.profile.condition}
    - Current Meds: ${context.medications.map((m: any) => m.name).join(', ')}
    - MedBox Status: ${JSON.stringify(context.medbox)}
    
    User Message: ${message}
    
    Respond with empathy, professional but warm tone. If they seem very ill, advise them to contact their doctor.
    You can send notifications, talk to the patient, or wake up if needed.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        tools: [{ functionDeclarations: [sendNotificationFunction, talkToPatientFunction, wakeUpFunction] }]
      }
    });
    return response;
  } catch (error) {
    console.error("Error getting agent response:", error);
    return null;
  }
};
