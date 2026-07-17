pub mod disassemble;
pub mod instructions;
pub mod opcodes;
use std::fmt;

#[derive(Debug, Clone)]
pub enum Value {
    Integer(i32),
    String(String),
    Boolean(bool),
    Register(u16),
    Float(f64),
    CodePoints(Vec<u32>),
    Undefined,
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Value::Integer(i) => write!(f, "{}", i),
            Value::String(s) => write!(f, r#""{}""#, s),
            Value::Boolean(b) => write!(f, "{}", b),
            Value::Register(r) => write!(f, "R{}", r),
            Value::Float(fl) => write!(f, "{}", fl),
            Value::CodePoints(b) => write!(f, "{:?}", b),
            Value::Undefined => write!(f, "undefined"),
        }
    }
}

impl Value {
    pub fn as_unicode(&self) -> Vec<u32> {
        match self {
            Value::CodePoints(u) => u.clone(),
            _ => vec![],
        }
    }

    pub fn as_number(&self) -> f64 {
        match self {
            Value::Integer(i) => *i as f64,
            Value::Float(f) => *f,
            Value::Boolean(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            _ => 0.0,
        }
    }

    pub fn as_register(&self) -> u16 {
        match self {
            Value::Register(r) => *r,
            _ => 0,
        }
    }

    pub fn as_str(&self) -> String {
        match self {
            Value::String(s) => s.clone(),
            _ => String::new(),
        }
    }
}
