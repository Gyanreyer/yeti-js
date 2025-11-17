{
  console.log("Hello from global.js");
  var sayHi = (name) => {
    console.log(`Hi ${name} from sub-dep!`);
  };
  sayHi("Bob");
}
