from google import genai
import inspect

print(inspect.signature(genai.Client().models.embed_content))
