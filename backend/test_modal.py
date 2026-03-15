import asyncio
from main import trigger_video_processing, ProcessVideoRequest

async def test():
    req = ProcessVideoRequest(job_id="val", video_s3_key="val2")
    try:
        res = await trigger_video_processing(req)
        print("Success:", res)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test())
