# Outfit agent Lambda (arm64, outside the VPC so it can reach Bedrock). Built and pushed by infra/deploy-agent.sh.
FROM public.ecr.aws/lambda/python:3.12
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Bake FashionCLIP into the image: Lambda has no writable cache and cold starts shouldn't download 600 MB
ENV HF_HOME=/opt/hf
RUN python -c "from transformers import CLIPModel, CLIPTokenizerFast; m='patrickjohncyh/fashion-clip'; CLIPModel.from_pretrained(m); CLIPTokenizerFast.from_pretrained(m)"
ENV HF_HUB_OFFLINE=1
COPY handler.py ${LAMBDA_TASK_ROOT}/
CMD ["handler.handler"]
