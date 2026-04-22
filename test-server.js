const express=require('express');
const app=express();
app.use(express.json());
app.post('/test',(req,res)=>{
  console.log('BODY:', JSON.stringify(req.body));
  res.json({received: req.body});
});
app.listen(3001,()=>console.log('test server on 3001'));
